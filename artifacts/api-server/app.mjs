// Vercel's Express detector requires an explicit import of this package.
import "express";

// Load the bundled app, not the source tree's bundler-style imports.
export { default } from "./dist/app.mjs";
