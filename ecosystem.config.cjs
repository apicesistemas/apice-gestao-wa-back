// PM2 do apice-gestao-wa-back no servidor interno (192.168.1.167). Usado pelo deploy.sh.
// Conferido por tests/ecosystem.config.test.js.
module.exports = {
  apps: [
    {
      name: "apice-gestao-wa-back",
      cwd: __dirname, // .env, sessoes-baileys/, .cache/ e LOGS/ são relativos à pasta do projeto
      script: "./src/index.js",
      node_args: "--env-file=.env",
      // Instância única e fork obrigatórios: cada equipe tem a sessão do Baileys em disco
      // (sessoes-baileys/) e um socket aberto no WhatsApp. Dois processos na mesma sessão disputam o
      // pareamento e o corrompem, e o cluster não faz sentido (as rotas dependem das instâncias em
      // memória deste processo). Por isso o reload é, na prática, stop gracioso + start.
      instances: 1,
      exec_mode: "fork",
      watch: false,
      autorestart: true,
      max_restarts: 10,
      min_uptime: 10000, // menos que isso no ar conta como queda para o max_restarts
      restart_delay: 5000,
      // Precisa ficar acima do teto do desligamento gracioso do src/index.js (MS_TETO_ENCERRAMENTO,
      // 10 s): o PM2 manda SIGINT e só mata depois disso, então o saveCreds e a fila de entrada
      // terminam e a sessão fica intacta (o boot seguinte reconecta sem QR).
      kill_timeout: 12000,
      listen_timeout: 10000,
      env: {
        NODE_ENV: "production",
        TZ: "America/Sao_Paulo",
        // Igual ao .env.example. O --env-file não sobrescreve variável que já existe no ambiente,
        // então sob o PM2 a porta é sempre esta (só rede interna, nunca exposta pelo nginx).
        SERVER_PORT: "3501",
      },
    },
  ],
};
