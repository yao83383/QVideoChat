module.exports = {
  apps: [
    {
      name: "qvideo-server",
      cwd: "/opt/qvideochat/server",
      script: "npx",
      args: "tsx src/index.ts",
      watch: false,
    },
    {
      name: "qvideo-client",
      cwd: "/opt/qvideochat/client",
      script: "npx",
      args: "next dev --port 3000",
      watch: false,
    },
  ],
};
