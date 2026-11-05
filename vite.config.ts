import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

interface NodeFs {
  existsSync(p: string): boolean;
  statSync(p: string): { isDirectory(): boolean; isFile(): boolean };
  readdirSync(p: string): string[];
  readFileSync(p: string, encoding: string): string;
}

interface NodePath {
  join(...paths: string[]): string;
  resolve(...paths: string[]): string;
}

interface IncomingReq {
  method?: string;
  url?: string;
  on(event: string, listener: (chunk?: unknown) => void): void;
}

interface ServerRes {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body: string): void;
}

function localDriveFolderPlugin(): Plugin {
  return {
    name: "local-drive-folder-scanner",
    configureServer(server) {
      server.middlewares.use((req: IncomingReq, res: ServerRes, next: () => void) => {
        if (req.url?.startsWith("/api/bedrock-chat") && req.method === "POST") {
          let rawBody = "";
          req.on("data", (chunk: unknown) => {
            rawBody += String(chunk ?? "");
          });
          req.on("end", () => {
            void (async () => {
              try {
                const payload = JSON.parse(rawBody || "{}") as {
                  messagesJson?: string;
                  systemPrompt?: string | null;
                  temperature?: number | null;
                  mode?: string | null;
                };
                const mod = await server.ssrLoadModule(
                  "/amplify/functions/bedrock-chat/handler.ts"
                );
                const result = await mod.handler({
                  arguments: {
                    messagesJson: payload.messagesJson || "[]",
                    systemPrompt: payload.systemPrompt,
                    temperature: payload.temperature,
                    mode: "bedrock",
                  },
                });
                res.statusCode = 200;
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify(result));
              } catch (err) {
                res.statusCode = 500;
                res.setHeader("Content-Type", "application/json");
                res.end(
                  JSON.stringify({
                    error: err instanceof Error ? err.message : String(err),
                  })
                );
              }
            })();
          });
          return;
        }

        if (!req.url?.startsWith("/api/local-folder") || req.method !== "POST") {
          next();
          return;
        }

        let rawBody = "";
        req.on("data", (chunk: unknown) => {
          rawBody += String(chunk ?? "");
        });

        req.on("end", () => {
          void (async () => {
            try {
              const fsSpecifier = "node:" + "fs";
              const pathSpecifier = "node:" + "path";
              const fs = (await import(/* @vite-ignore */ fsSpecifier)) as unknown as NodeFs;
              const path = (await import(/* @vite-ignore */ pathSpecifier)) as unknown as NodePath;

              const payload = JSON.parse(rawBody || "{}") as {
                folderPath?: string;
                kind?: "water-json" | "dem";
              };
              const targetFolder = (payload.folderPath || "").trim();

              if (!targetFolder) {
                res.statusCode = 400;
                res.setHeader("Content-Type", "application/json");
                res.end(
                  JSON.stringify({
                    exists: false,
                    error: "Please enter a local drive folder path.",
                  })
                );
                return;
              }

              const resolvedFolder = path.resolve(targetFolder);
              if (
                !fs.existsSync(resolvedFolder) ||
                !fs.statSync(resolvedFolder).isDirectory()
              ) {
                res.statusCode = 200;
                res.setHeader("Content-Type", "application/json");
                res.end(
                  JSON.stringify({
                    exists: false,
                    folderPath: resolvedFolder,
                    files: [],
                    tifFiles: [],
                    error: `Folder not found on local drive: ${resolvedFolder}`,
                  })
                );
                return;
              }

              const entries = fs.readdirSync(resolvedFolder);

              if (payload.kind === "dem") {
                const tifFiles = entries.filter((name) =>
                  /\.(tif|tiff)$/i.test(name)
                );
                res.statusCode = 200;
                res.setHeader("Content-Type", "application/json");
                res.end(
                  JSON.stringify({
                    exists: true,
                    folderPath: resolvedFolder,
                    tifFiles,
                  })
                );
                return;
              }

              const jsonEntries = entries.filter((name) =>
                /\.(json|geojson)$/i.test(name)
              );
              const files: Array<{ name: string; content: string }> = [];

              for (const fileName of jsonEntries) {
                const fullPath = path.join(resolvedFolder, fileName);
                if (fs.statSync(fullPath).isFile()) {
                  const content = fs.readFileSync(fullPath, "utf-8");
                  files.push({ name: fileName, content });
                }
              }

              res.statusCode = 200;
              res.setHeader("Content-Type", "application/json");
              res.end(
                JSON.stringify({
                  exists: true,
                  folderPath: resolvedFolder,
                  files,
                })
              );
            } catch (err) {
              res.statusCode = 500;
              res.setHeader("Content-Type", "application/json");
              res.end(
                JSON.stringify({
                  exists: false,
                  error: err instanceof Error ? err.message : String(err),
                })
              );
            }
          })();
        });
      });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), localDriveFolderPlugin()],
});

