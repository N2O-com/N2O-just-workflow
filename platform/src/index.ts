import { ApolloServer } from "@apollo/server";
import { startStandaloneServer } from "@apollo/server/standalone";
import { typeDefs } from "./schema/typeDefs.js";
import { resolvers } from "./resolvers/index.js";
import { getDb, closeDb } from "./db.js";
import { createLoaders } from "./loaders.js";

const PORT = parseInt(process.env.PORT ?? "4000");

const server = new ApolloServer({
  typeDefs,
  resolvers,
});

const { url } = await startStandaloneServer(server, {
  listen: { port: PORT },
  context: async () => {
    const db = getDb();
    return {
      db,
      loaders: createLoaders(db),
    };
  },
});

console.log(`N2O Data Platform API ready at ${url}`);

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\nShutting down...");
  closeDb();
  process.exit(0);
});

process.on("SIGTERM", () => {
  closeDb();
  process.exit(0);
});
