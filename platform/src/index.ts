// Platform API server: Apollo Server 5 + Express + Supabase Postgres.
// Serves the N2O GraphQL schema on /graphql and SMS webhook on /sms/inbound.
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import http from "node:http";
import { ApolloServer } from "@apollo/server";
import { expressMiddleware } from "@as-integrations/express5";
import cors from "cors";
import express from "express";
import jwt from "jsonwebtoken";
import { typeDefs } from "./schema/typeDefs.js";
import { resolvers } from "./resolvers/index.js";
import { getPool, closePool, validateDbConfig } from "./db.js";
import { createLoaders } from "./loaders.js";
import { auditLogPlugin } from "./plugins/audit-log.js";
import type { CurrentUser } from "./context.js";

// Validate required env vars before starting
validateDbConfig();

const PORT = parseInt(process.env.PORT ?? "4000");
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET;
const DEV_MODE = process.env.N2O_DEV_MODE === "true";

const app = express();
const httpServer = http.createServer(app);

const server = new ApolloServer({
  typeDefs,
  resolvers,
  plugins: [auditLogPlugin],
});

await server.start();

const pool = getPool();

// Mount GraphQL endpoint
app.use(
  "/graphql",
  cors<cors.CorsRequest>(),
  express.json(),
  expressMiddleware(server, {
    context: async ({ req }) => {
      let currentUser: CurrentUser | null = null;

      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith("Bearer ") && JWT_SECRET) {
        try {
          const token = authHeader.slice(7);
          const decoded = jwt.verify(token, JWT_SECRET) as {
            email?: string;
          };
          if (decoded.email) {
            const { rows } = await pool.query(
              `SELECT name, email, access_role FROM developers WHERE email = $1`,
              [decoded.email]
            );
            if (rows.length > 0) {
              currentUser = {
                name: rows[0].name,
                email: rows[0].email,
                accessRole: rows[0].access_role,
              };
            }
          }
        } catch {
          // Invalid token — currentUser stays null
        }
      } else if (!authHeader && DEV_MODE) {
        // Dev mode: default to admin when no auth header
        currentUser = {
          name: "whsimonds",
          accessRole: "admin",
          email: "dev@local",
        };
      }

      return {
        db: pool,
        loaders: createLoaders(pool),
        currentUser,
      };
    },
  })
);

// SMS webhook placeholder (Task 3 will implement the full handler)
app.post("/sms/inbound", express.urlencoded({ extended: false }), (_req, res) => {
  res.sendStatus(200);
});

await new Promise<void>((resolve) => httpServer.listen(PORT, resolve));
console.log(`N2O Data Platform API ready at http://localhost:${PORT}/graphql`);

// Graceful shutdown
async function shutdown() {
  await server.stop();
  httpServer.close();
  await closePool();
  process.exit(0);
}

process.on("SIGINT", async () => {
  console.log("\nShutting down...");
  await shutdown();
});

process.on("SIGTERM", async () => {
  await shutdown();
});
