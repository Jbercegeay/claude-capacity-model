module.exports = {
  apps: [
    {
      name: 'claude-capacity-model',
      script: 'server.js',
      cwd: 'C:\\ServerData\\Repos\\claude-capacity-model',
      interpreter: 'node',
      env: {
        NODE_ENV: 'production',
        PORT: 3380,
      },
      restart_delay: 5000,
      max_restarts: 10,
      watch: false,
    },
  ],
};
