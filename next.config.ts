import type { NextConfig } from "next";
const config: NextConfig = { outputFileTracingRoot: process.cwd(), webpack: c => { c.resolve.alias.canvas = false; return c; } };
export default config;
