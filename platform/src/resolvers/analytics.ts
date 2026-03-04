import { skillQueryResolvers } from "./skill-analytics.js";
import { velocityQueryResolvers } from "./velocity-analytics.js";
import { qualityQueryResolvers } from "./quality-analytics.js";

export const analyticsResolvers = {
  Query: {
    ...skillQueryResolvers,
    ...velocityQueryResolvers,
    ...qualityQueryResolvers,
  },
};
