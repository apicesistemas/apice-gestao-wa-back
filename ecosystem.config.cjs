module.exports = {
  apps: [
    {
      name: "apice-gestao-wa-back",
      script: "./src/index.js",
      node_args: "--env-file=.env",
      // Instância única obrigatória: a sessão do Baileys fica em disco (sessoes-baileys/)
      // e dois processos na mesma sessão corrompem o pareamento.
      instances: 1,
      exec_mode: "fork",
      // Tempo para o desligamento gracioso terminar o saveCreds antes do kill.
      kill_timeout: 12000,
      env: {
        NODE_ENV: "production",
        TZ: "America/Sao_Paulo",
      },
    },
  ],
};
