// Platform API server: Apollo Server 5 + Supabase Postgres, serves the N2O GraphQL schema on port 4000.
import "dotenv/config";
import { ApolloServer } from "@apollo/server";
import { startStandaloneServer } from "@apollo/server/standalone";
import { typeDefs } from "./schema/typeDefs.js";
import { resolvers } from "./resolvers/index.js";
import { getPool, closePool } from "./db.js";
import { createLoaders } from "./loaders.js";

const PORT = parseInt(process.env.PORT ?? "4000");

const server = new ApolloServer({
  typeDefs,
  resolvers,
});

const pool = getPool();

const { url } = await startStandaloneServer(server, {
  listen: { port: PORT },
  context: async () => ({
    db: pool,
    loaders: createLoaders(pool),
  }),
});

console.log(`N2O Data Platform API ready at ${url}`);

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\nShutting down...");
  await closePool();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await closePool();
  process.exit(0);
});
