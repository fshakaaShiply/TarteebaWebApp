// PM2 process file for the staging/production server (spec §23.4).
// The deploy script uploads Next's standalone build to /var/www/tarteeba/web/releases/<id>
// and points /var/www/tarteeba/web/current at it.
module.exports = {
  apps: [
    {
      name: "tarteeba-web",
      cwd: "/var/www/tarteeba/web/current",
      script: "server.js",
      instances: 2,
      exec_mode: "cluster",
      env: { NODE_ENV: "production", PORT: 3000, HOSTNAME: "127.0.0.1" },
      max_memory_restart: "600M",
      out_file: "/var/log/tarteeba/web.out.log",
      error_file: "/var/log/tarteeba/web.err.log",
    },
  ],
};
