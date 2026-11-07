import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import type { SkillDetail, SkillVersionDetail, User, HealthStatus, StatsResponse } from "../src/lib/registry.js";

export interface MockRegistryOptions {
  port?: number;
}

export class MockRegistryServer {
  private server: Server | null = null;
  private port: number = 0;
  private url: string = "";

  public skills = new Map<string, SkillDetail>();
  public tarballs = new Map<string, Buffer>(); // key: `${name}@${version}`
  public tokens = new Set<string>(["apt_live_test_token_123"]);
  public user: User = {
    id: "usr_mock_123",
    handle: "mockuser",
    name: "Mock User",
    email: "mock@skillapt.dev",
    avatarUrl: "https://skillapt.dev/avatar.png",
    createdAt: new Date().toISOString(),
  };

  async start(): Promise<string> {
    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => {
        this.handleRequest(req, res).catch((err) => {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: { code: "INTERNAL_ERROR", message: String(err) } }));
        });
      });

      this.server.listen(0, "127.0.0.1", () => {
        const addr = this.server?.address();
        if (typeof addr === "object" && addr) {
          this.port = addr.port;
          this.url = `http://127.0.0.1:${this.port}`;
          resolve(this.url);
        } else {
          reject(new Error("Cannot get mock server address"));
        }
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  getUrl(): string {
    return this.url;
  }

  addSkill(detail: SkillDetail, versionTarballs: Record<string, Buffer> = {}): void {
    this.skills.set(detail.name, detail);
    for (const [ver, buf] of Object.entries(versionTarballs)) {
      this.tarballs.set(`${detail.name}@${ver}`, buf);
    }
  }

  private getAuthHeader(req: IncomingMessage): string | null {
    const auth = req.headers.authorization;
    if (auth && auth.startsWith("Bearer ")) {
      return auth.slice(7).trim();
    }
    return null;
  }

  private async readBody(req: IncomingMessage): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  private sendJson(res: ServerResponse, statusCode: number, data: unknown): void {
    res.statusCode = statusCode;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(data));
  }

  private sendError(res: ServerResponse, statusCode: number, code: string, message: string): void {
    this.sendJson(res, statusCode, { error: { code, message } });
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const parsedUrl = new URL(req.url ?? "/", `http://127.0.0.1:${this.port}`);
    let pathname = decodeURIComponent(parsedUrl.pathname);

    // Normalize /v1 prefix
    if (pathname.startsWith("/v1/")) {
      pathname = pathname.slice(3);
    }

    const method = req.method?.toUpperCase();

    // GET /health or /v1/health
    if (pathname === "/health" && method === "GET") {
      const health: HealthStatus = {
        status: "ok",
        product: "skillapt",
        version: "1.1.0",
        timestamp: new Date().toISOString(),
      };
      return this.sendJson(res, 200, health);
    }

    // GET /stats or /v1/stats
    if (pathname === "/stats" && method === "GET") {
      const stats: StatsResponse = {
        totalSkills: this.skills.size,
        totalVersions: Array.from(this.skills.values()).reduce((acc, s) => acc + Object.keys(s.versions).length, 0),
        totalDownloads: 1234,
        totalAuthors: 1,
      };
      return this.sendJson(res, 200, stats);
    }

    // GET /me or /v1/me
    if (pathname === "/me" && method === "GET") {
      const token = this.getAuthHeader(req);
      if (!token || !this.tokens.has(token)) {
        return this.sendError(res, 401, "UNAUTHORIZED", "Missing or invalid authorization token.");
      }
      return this.sendJson(res, 200, this.user);
    }

    // GET /skills or /v1/skills
    if (pathname === "/skills" && method === "GET") {
      const q = parsedUrl.searchParams.get("q")?.toLowerCase();
      let list = Array.from(this.skills.values());

      if (q) {
        list = list.filter((s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q));
      }

      const summaries = list.map((s) => ({
        name: s.name,
        latestVersion: s.latestVersion,
        description: s.description,
        license: s.license,
        category: s.category,
        compatibility: s.compatibility,
        downloads: s.downloads,
        verified: true,
        owner: s.owner,
        updatedAt: s.updatedAt,
      }));

      return this.sendJson(res, 200, {
        skills: summaries,
        pagination: {
          page: 1,
          limit: 20,
          total: summaries.length,
          totalPages: 1,
        },
      });
    }

    // Download tarball: GET /skills/:name/-/:version.tgz
    const tarballMatch = pathname.match(/^\/skills\/(.+)\/-\/([0-9a-zA-Z.-]+)\.tgz$/);
    if (tarballMatch && method === "GET") {
      const skillName = tarballMatch[1];
      const version = tarballMatch[2];

      const skill = this.skills.get(skillName);
      if (!skill) {
        return this.sendError(res, 404, "NOT_FOUND", `Skill '${skillName}' not found.`);
      }

      const verSummary = skill.versions[version];
      if (!verSummary) {
        return this.sendError(res, 404, "NOT_FOUND", `Version '${version}' not found.`);
      }

      if (verSummary.removed || verSummary.status === "removed") {
        return this.sendError(res, 410, "GONE", `Version '${version}' has been permanently removed.`);
      }

      const tarballKey = `${skillName}@${version}`;
      const buf = this.tarballs.get(tarballKey);
      if (!buf) {
        return this.sendError(res, 404, "NOT_FOUND", "Tarball not found.");
      }

      res.statusCode = 200;
      res.setHeader("Content-Type", "application/gzip");
      res.setHeader("Content-Disposition", `attachment; filename="${skillName}-${version}.tgz"`);
      res.setHeader("ETag", `"${verSummary.sha256}"`);
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      return res.end(buf);
    }

    // Yank: POST /skills/:name/:version/yank
    const yankMatch = pathname.match(/^\/skills\/(.+)\/([0-9a-zA-Z.-]+)\/yank$/);
    if (yankMatch && method === "POST") {
      const token = this.getAuthHeader(req);
      if (!token || !this.tokens.has(token)) {
        return this.sendError(res, 401, "UNAUTHORIZED", "Authentication required to yank.");
      }

      const skillName = yankMatch[1];
      const version = yankMatch[2];
      const skill = this.skills.get(skillName);

      if (!skill || !skill.versions[version]) {
        return this.sendError(res, 404, "NOT_FOUND", `Skill '${skillName}@${version}' not found.`);
      }

      const bodyRaw = await this.readBody(req);
      let reason: string | undefined;
      try {
        const parsed = JSON.parse(bodyRaw.toString("utf-8"));
        reason = parsed.reason;
      } catch {
        // no body
      }

      skill.versions[version].yanked = true;
      skill.versions[version].status = "yanked";

      return this.sendJson(res, 200, {
        name: skillName,
        version,
        yanked: true,
        message: `Version ${version} has been yanked.`,
      });
    }

    // Version detail: GET /skills/:name/:version
    const verMatch = pathname.match(/^\/skills\/(.+)\/([0-9a-zA-Z.-]+)$/);
    if (verMatch && method === "GET") {
      const skillName = verMatch[1];
      const version = verMatch[2];

      const skill = this.skills.get(skillName);
      if (!skill) {
        return this.sendError(res, 404, "NOT_FOUND", `Skill '${skillName}' not found.`);
      }

      const verSummary = skill.versions[version];
      if (!verSummary) {
        return this.sendError(res, 404, "NOT_FOUND", `Version '${version}' not found.`);
      }

      const detail: SkillVersionDetail = {
        name: skillName,
        version: verSummary.version,
        integrity: verSummary.integrity ?? `sha256-${verSummary.sha256}`,
        sha256: verSummary.sha256,
        size: verSummary.size,
        tarballUrl: verSummary.tarballUrl,
        dependencies: verSummary.dependencies,
        publishedAt: verSummary.publishedAt,
        status: verSummary.status ?? "active",
        yanked: verSummary.yanked,
        removed: verSummary.removed ?? false,
        removalReason: verSummary.removalReason ?? null,
        permissions: verSummary.permissions,
      };

      return this.sendJson(res, 200, detail);
    }

    // Skill detail: GET /skills/:name
    const skillMatch = pathname.match(/^\/skills\/(.+)$/);
    if (skillMatch && method === "GET") {
      const skillName = skillMatch[1];
      const skill = this.skills.get(skillName);
      if (!skill) {
        return this.sendError(res, 404, "NOT_FOUND", `Skill '${skillName}' does not exist.`);
      }
      return this.sendJson(res, 200, skill);
    }

    // Publish: POST /skills
    if (pathname === "/skills" && method === "POST") {
      const token = this.getAuthHeader(req);
      if (!token || !this.tokens.has(token)) {
        return this.sendError(res, 401, "UNAUTHORIZED", "Authentication required to publish skills.");
      }

      const bodyBuffer = await this.readBody(req);
      if (bodyBuffer.length > 5 * 1024 * 1024) {
        return this.sendError(res, 413, "PAYLOAD_TOO_LARGE", "Uploaded tarball exceeds 5 MB limit.");
      }

      // Extract tarball from multipart or direct body
      let tarballBytes = bodyBuffer;
      const contentType = req.headers["content-type"] || "";

      if (contentType.includes("multipart/form-data")) {
        // Find boundary and extract file bytes
        const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
        if (boundaryMatch) {
          const boundary = boundaryMatch[1] || boundaryMatch[2];
          const parts = splitMultipart(bodyBuffer, boundary);
          if (parts.length > 0) {
            tarballBytes = parts[0].data;
          }
        }
      }

      const sha256 = createHash("sha256").update(tarballBytes).digest("hex");
      const integrity = `sha256-${sha256}`;

      // In mock, we inspect headers or parse published name from custom header or mock
      const pubName = (req.headers["x-skill-name"] as string) || "mock-published-skill";
      const pubVersion = (req.headers["x-skill-version"] as string) || "1.0.0";

      const tarballUrl = `${this.url}/v1/skills/${pubName}/-/${pubVersion}.tgz`;

      const versionSummary = {
        version: pubVersion,
        integrity,
        sha256,
        size: tarballBytes.length,
        tarballUrl,
        dependencies: {},
        publishedAt: new Date().toISOString(),
        status: "active" as const,
        yanked: false,
        removed: false,
        permissions: { network: false, shell: false, filesystem: "none" as const },
      };

      let existing = this.skills.get(pubName);
      if (!existing) {
        existing = {
          name: pubName,
          description: "Published mock skill",
          license: "MIT",
          category: "documents",
          compatibility: ["claude", "cursor"],
          owner: { handle: this.user.handle, avatarUrl: this.user.avatarUrl },
          latestVersion: pubVersion,
          downloads: 0,
          versions: {},
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        this.skills.set(pubName, existing);
      } else if (existing.versions[pubVersion]) {
        return this.sendError(res, 409, "CONFLICT", `Version ${pubVersion} has already been published and is immutable.`);
      }

      existing.versions[pubVersion] = versionSummary;
      existing.latestVersion = pubVersion;
      this.tarballs.set(`${pubName}@${pubVersion}`, tarballBytes);

      return this.sendJson(res, 201, {
        name: pubName,
        version: pubVersion,
        integrity,
        sha256,
        size: tarballBytes.length,
        tarballUrl,
        message: `Successfully published ${pubName}@${pubVersion}`,
      });
    }

    return this.sendError(res, 404, "NOT_FOUND", `Endpoint ${method} ${pathname} not found.`);
  }
}

function splitMultipart(body: Buffer, boundary: string): Array<{ data: Buffer; headers: Record<string, string> }> {
  const boundaryBuf = Buffer.from(`--${boundary}`);
  const result: Array<{ data: Buffer; headers: Record<string, string> }> = [];

  let start = 0;
  while (start < body.length) {
    const idx = body.indexOf(boundaryBuf, start);
    if (idx === -1) break;

    const nextIdx = body.indexOf(boundaryBuf, idx + boundaryBuf.length);
    if (nextIdx === -1) break;

    const partBuf = body.slice(idx + boundaryBuf.length, nextIdx);
    const headerEnd = partBuf.indexOf("\r\n\r\n");

    if (headerEnd !== -1) {
      const data = partBuf.slice(headerEnd + 4, partBuf.length - 2); // trim trailing \r\n
      result.push({ data, headers: {} });
    }

    start = nextIdx;
  }

  return result;
}
