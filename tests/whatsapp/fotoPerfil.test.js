// @ts-check
// Miniatura da foto de perfil (Fase 32, Task 32.1, contrato D2): profilePictureUrl "preview", allowlist de host,
// https, redirect "error", teto técnico, tipo pelo conteúdo e nada em disco. Socket, download e relógio falsos;
// nenhuma rede real. O console é capturado: nada de URL, JID ou LID nele.
const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const baileysFalso = require("../helpers/baileysFalso");

baileysFalso.instalarBaileysFalso();
const { obterPreview, foiRedirecionamento, ErroFoto, MS_PRAZO_FOTO, TETO_FOTO_BYTES, HOST_PERMITIDO } = require("../../src/whatsapp/fotoPerfil");

const { criarFotoFalsa, erroBoomFalso } = baileysFalso;
const JID = "5511900000010@s.whatsapp.net";
const URL_OK = "https://pps.whatsapp.net/v/t61/falso.jpg?ccb=1";
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(60, 7)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 3)]);
const WEBP = Buffer.concat([Buffer.from("RIFF", "latin1"), Buffer.alloc(4), Buffer.from("WEBP", "latin1"), Buffer.alloc(40, 1)]);

/** @type {string[]} */
let linhas = [];
const originais = { log: console.log, error: console.error, warn: console.warn };

beforeEach(() => {
  linhas = [];
  const gravar = (/** @type {any[]} */ ...args) => void linhas.push(args.map(String).join(" "));
  console.log = gravar;
  console.error = gravar;
  console.warn = gravar;
});
afterEach(() => {
  console.log = originais.log;
  console.error = originais.error;
  console.warn = originais.warn;
});

/**
 * Resposta falsa do fetch.
 * @param {Buffer | AsyncIterable<Buffer>} corpo
 * @param {{ status?: number, tamanho?: number | null }} [opcoes]
 */
function resposta(corpo, { status = 200, tamanho = null } = {}) {
  const iteravel = Buffer.isBuffer(corpo) ? (async function* () { yield corpo; })() : corpo;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (/** @type {string} */ nome) => (nome.toLowerCase() === "content-length" && tamanho !== null ? String(tamanho) : null) },
    body: iteravel,
  };
}

/**
 * @param {{ urls?: Record<string, any>, baixar?: (url: string, init: any) => Promise<any> }} [config]
 */
function montar({ urls = { [JID]: URL_OK }, baixar } = {}) {
  const foto = criarFotoFalsa({ urls });
  /** @type {{ url: string, init: any }[]} */
  const downloads = [];
  const baixarFalso = async (/** @type {string} */ url, /** @type {any} */ init) => {
    downloads.push({ url, init });
    return (baixar ?? (async () => resposta(JPEG)))(url, init);
  };
  return { socket: foto.metodos, consultas: foto.chamadas, downloads, baixar: baixarFalso };
}

/** @param {Promise<any>} promessa @param {string} codigo */
const rejeitaCom = (promessa, codigo) => assert.rejects(promessa, (e) => e instanceof ErroFoto && e.codigo === codigo);

test("URL presente → COM_FOTO com o base64 do JPEG, pedindo o preview e o prazo técnico ao Baileys", async () => {
  const m = montar();
  const r = await obterPreview(m.socket, JID, { baixar: m.baixar });
  assert.deepEqual(r, { situacao: "COM_FOTO", mimetype: "image/jpeg", conteudo_base64: JPEG.toString("base64") });
  assert.deepEqual(m.consultas, [{ jid: JID, tipo: "preview", timeoutMs: MS_PRAZO_FOTO }]);
  assert.equal(m.downloads[0]?.url, URL_OK);
  assert.equal(m.downloads[0]?.init.redirect, "error");
});

test("PNG e WebP também são aceitos, com o mimetype detectado pelo conteúdo", async () => {
  for (const [buffer, mimetype] of /** @type {[Buffer, string][]} */ ([[PNG, "image/png"], [WEBP, "image/webp"]])) {
    const m = montar({ baixar: async () => resposta(buffer) });
    const r = await obterPreview(m.socket, JID, { baixar: m.baixar });
    assert.equal(r.situacao, "COM_FOTO");
    assert.equal(/** @type {any} */ (r).mimetype, mimetype);
  }
});

test("URL ausente, Boom 401 ou 404 → SEM_FOTO, sem fetch", async () => {
  for (const urls of [{ [JID]: undefined }, { [JID]: erroBoomFalso("not-authorized", 401) }, { [JID]: erroBoomFalso("item-not-found", 404) }, {}]) {
    const m = montar({ urls });
    assert.deepEqual(await obterPreview(m.socket, JID, { baixar: m.baixar }), { situacao: "SEM_FOTO" });
    assert.equal(m.downloads.length, 0);
  }
});

test("host fora de .whatsapp.net, http, porta, credencial ou URL inválida → SEM_FOTO, sem fetch", async () => {
  const ruins = [
    "https://evil.example.com/foto.jpg",
    "https://pps.whatsapp.net.evil.example.com/foto.jpg",
    "https://evil.example.com/.whatsapp.net",
    "https://whatsapp.net/foto.jpg",
    "https://xwhatsapp.net/foto.jpg",
    "http://pps.whatsapp.net/foto.jpg",
    "https://pps.whatsapp.net:8443/foto.jpg",
    "https://user:senha@pps.whatsapp.net/foto.jpg",
    "ftp://pps.whatsapp.net/foto.jpg",
    "isto não é uma url",
  ];
  for (const url of ruins) {
    const m = montar({ urls: { [JID]: url } });
    assert.deepEqual(await obterPreview(m.socket, JID, { baixar: m.baixar }), { situacao: "SEM_FOTO" }, url);
    assert.equal(m.downloads.length, 0, url);
  }
});

test("o host é conferido sem diferenciar maiúsculas e só o sufixo exato conta", async () => {
  assert.equal(HOST_PERMITIDO, ".whatsapp.net");
  const m = montar({ urls: { [JID]: "https://MMG.WhatsApp.NET/v/foto.jpg" } });
  assert.equal((await obterPreview(m.socket, JID, { baixar: m.baixar })).situacao, "COM_FOTO");
});

test("redirecionamento (fetch com redirect error) → SEM_FOTO; outra falha de rede → FALHA", async () => {
  const redirecionou = montar({
    baixar: async () => {
      throw Object.assign(new TypeError("fetch failed"), { cause: new Error("unexpected redirect") });
    },
  });
  assert.deepEqual(await obterPreview(redirecionou.socket, JID, { baixar: redirecionou.baixar }), { situacao: "SEM_FOTO" });
  const caiu = montar({
    baixar: async () => {
      throw Object.assign(new TypeError("fetch failed"), { cause: new Error("connect ECONNREFUSED") });
    },
  });
  await rejeitaCom(obterPreview(caiu.socket, JID, { baixar: caiu.baixar }), "FALHA");
});

test("conteúdo acima do teto técnico → SEM_FOTO (por Content-Length e pelo que chega, com o stream destruído)", async () => {
  const porCabecalho = montar({ baixar: async () => resposta(JPEG, { tamanho: TETO_FOTO_BYTES + 1 }) });
  assert.deepEqual(await obterPreview(porCabecalho.socket, JID, { baixar: porCabecalho.baixar }), { situacao: "SEM_FOTO" });

  let encerrou = false;
  const grande = montar({
    baixar: async () =>
      resposta(
        (async function* () {
          try {
            yield Buffer.concat([JPEG, Buffer.alloc(TETO_FOTO_BYTES, 1)]);
            yield Buffer.alloc(10);
          } finally {
            encerrou = true;
          }
        })()
      ),
  });
  assert.deepEqual(await obterPreview(grande.socket, JID, { baixar: grande.baixar }), { situacao: "SEM_FOTO" });
  assert.equal(encerrou, true);
});

test("o teto é injetável e exatamente no teto passa", async () => {
  const m = montar();
  assert.equal((await obterPreview(m.socket, JID, { baixar: m.baixar, tetoBytes: JPEG.length })).situacao, "COM_FOTO");
  assert.deepEqual(await obterPreview(m.socket, JID, { baixar: m.baixar, tetoBytes: JPEG.length - 1 }), { situacao: "SEM_FOTO" });
});

test("conteúdo que não é imagem (HTML, GIF, vazio) → SEM_FOTO", async () => {
  for (const corpo of [Buffer.from("<html>erro</html>"), Buffer.from("GIF89a" + "x".repeat(30)), Buffer.alloc(0)]) {
    const m = montar({ baixar: async () => resposta(corpo) });
    assert.deepEqual(await obterPreview(m.socket, JID, { baixar: m.baixar }), { situacao: "SEM_FOTO" });
  }
});

test("status HTTP: 404 → SEM_FOTO, 429 → LIMITE_WHATSAPP, 500 → FALHA", async () => {
  const naoAchou = montar({ baixar: async () => resposta(JPEG, { status: 404 }) });
  assert.deepEqual(await obterPreview(naoAchou.socket, JID, { baixar: naoAchou.baixar }), { situacao: "SEM_FOTO" });
  const limite = montar({ baixar: async () => resposta(JPEG, { status: 429 }) });
  await rejeitaCom(obterPreview(limite.socket, JID, { baixar: limite.baixar }), "LIMITE_WHATSAPP");
  const erro = montar({ baixar: async () => resposta(JPEG, { status: 500 }) });
  await rejeitaCom(obterPreview(erro.socket, JID, { baixar: erro.baixar }), "FALHA");
});

test("rate-overlimit (data 429 ou texto) → LIMITE_WHATSAPP, sem fetch", async () => {
  for (const erro of [erroBoomFalso("rate-overlimit", 429), new Error("rate-overlimit")]) {
    const m = montar({ urls: { [JID]: erro } });
    await rejeitaCom(obterPreview(m.socket, JID, { baixar: m.baixar }), "LIMITE_WHATSAPP");
    assert.equal(m.downloads.length, 0);
  }
});

test("outra falha do IQ → FALHA; socket sem profilePictureUrl → FALHA", async () => {
  const m = montar({ urls: { [JID]: erroBoomFalso("internal-server-error", 500) } });
  await rejeitaCom(obterPreview(m.socket, JID, { baixar: m.baixar }), "FALHA");
  await rejeitaCom(obterPreview({}, JID, { baixar: m.baixar }), "FALHA");
});

test("prazo do IQ → PRAZO_ESGOTADO; prazo do download → PRAZO_ESGOTADO, abortando o fetch", async () => {
  const iq = montar({ urls: { [JID]: "travar" } });
  await rejeitaCom(obterPreview(iq.socket, JID, { baixar: iq.baixar, msPrazo: 20 }), "PRAZO_ESGOTADO");
  assert.equal(iq.downloads.length, 0);

  /** @type {AbortSignal | undefined} */
  let sinal;
  const lento = montar({
    baixar: (_url, init) => {
      sinal = init.signal;
      return new Promise((_, rejeitar) => {
        init.signal.addEventListener("abort", () => rejeitar(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
      });
    },
  });
  await rejeitaCom(obterPreview(lento.socket, JID, { baixar: lento.baixar, msPrazo: 20 }), "PRAZO_ESGOTADO");
  assert.equal(sinal?.aborted, true);
});

test("prazo durante a leitura do corpo → PRAZO_ESGOTADO", async () => {
  const m = montar({
    baixar: async (_url, init) =>
      resposta(
        (async function* () {
          yield JPEG.subarray(0, 10);
          await new Promise((_, rejeitar) => init.signal.addEventListener("abort", () => rejeitar(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true }));
        })()
      ),
  });
  await rejeitaCom(obterPreview(m.socket, JID, { baixar: m.baixar, msPrazo: 20 }), "PRAZO_ESGOTADO");
});

test("sem baixar injetado usa o fetch global com redirect error e sem seguir redirecionamento", async () => {
  const original = globalThis.fetch;
  /** @type {{ url: string, init: any }[]} */
  const chamadas = [];
  globalThis.fetch = /** @type {any} */ (async (/** @type {string} */ url, /** @type {any} */ init) => {
    chamadas.push({ url, init });
    return new Response(JPEG, { status: 200 });
  });
  try {
    const m = montar();
    const r = await obterPreview(m.socket, JID);
    assert.equal(r.situacao, "COM_FOTO");
    assert.equal(chamadas.length, 1);
    assert.equal(chamadas[0]?.url, URL_OK);
    assert.equal(chamadas[0]?.init.redirect, "error");
    assert.ok(chamadas[0]?.init.signal instanceof AbortSignal);
  } finally {
    globalThis.fetch = original;
  }
});

test("resposta sem corpo legível → SEM_FOTO", async () => {
  const m = montar({ baixar: async () => ({ ok: true, status: 200, headers: { get: () => null }, body: null }) });
  assert.deepEqual(await obterPreview(m.socket, JID, { baixar: m.baixar }), { situacao: "SEM_FOTO" });
});

test("nada em disco: nenhuma escrita em fs durante nenhum caminho, e nenhum log leva URL, jid ou LID", async () => {
  /** @type {string[]} */
  const escritas = [];
  const nomes = /** @type {const} */ (["writeFile", "writeFileSync", "appendFile", "appendFileSync", "createWriteStream", "mkdir", "mkdirSync", "rename", "renameSync", "copyFile", "copyFileSync", "open", "openSync"]);
  const originaisFs = new Map();
  for (const nome of nomes) {
    originaisFs.set(nome, /** @type {any} */ (fs)[nome]);
    /** @type {any} */ (fs)[nome] = (/** @type {any[]} */ ...args) => {
      escritas.push(nome);
      return originaisFs.get(nome)(...args);
    };
  }
  try {
    const cenarios = [
      montar(),
      montar({ urls: { [JID]: undefined } }),
      montar({ urls: { [JID]: erroBoomFalso("rate-overlimit", 429) } }),
      montar({ urls: { [JID]: "https://evil.example.com/x.jpg" } }),
      montar({ baixar: async () => resposta(Buffer.from("<html>")) }),
      montar({ baixar: async () => { throw new TypeError("fetch failed https://pps.whatsapp.net/v/segredo"); } }),
    ];
    for (const m of cenarios) await obterPreview(m.socket, JID, { baixar: m.baixar }).catch(() => {});
  } finally {
    for (const nome of nomes) /** @type {any} */ (fs)[nome] = originaisFs.get(nome);
  }
  assert.deepEqual(escritas, []);
  assert.doesNotMatch(linhas.join("\n"), /whatsapp\.net|evil\.example|segredo|5511|@lid/);
});

test("nenhum cache de imagem: duas chamadas iguais consultam e baixam duas vezes", async () => {
  const m = montar();
  await obterPreview(m.socket, JID, { baixar: m.baixar });
  await obterPreview(m.socket, JID, { baixar: m.baixar });
  assert.equal(m.consultas.length, 2);
  assert.equal(m.downloads.length, 2);
});

test("fetch REAL com redirect error contra um servidor local que responde 302: o erro é reconhecido e vira SEM_FOTO", async () => {
  /** @type {string[]} */
  const pedidos = [];
  const servidor = http.createServer((req, res) => {
    pedidos.push(String(req.url));
    res.writeHead(302, { location: "/destino" });
    res.end();
  });
  await new Promise((resolve) => servidor.listen(0, "127.0.0.1", () => resolve(undefined)));
  const endereco = servidor.address();
  assert.ok(endereco && typeof endereco === "object");
  const local = `http://127.0.0.1:${endereco.port}/foto.jpg`;
  try {
    // O erro capturado de um fetch real é reconhecido por `foiRedirecionamento`.
    const erro = await fetch(local, { redirect: "error" }).then(
      () => null,
      (e) => e
    );
    assert.ok(erro instanceof TypeError);
    assert.equal(foiRedirecionamento(erro), true, "o texto do undici mudou? revisar foiRedirecionamento");
    // Outra falha real de rede (porta fechada) NÃO é redirecionamento.
    const fechada = await fetch("http://127.0.0.1:1/", { redirect: "error" }).then(
      () => null,
      (e) => e
    );
    assert.equal(foiRedirecionamento(fechada), false);
    // Ponta a ponta: a checagem de host fica de fora só aqui (o `baixar` aponta para o servidor local).
    const m = montar();
    const r = await obterPreview(m.socket, JID, { baixar: (_url, init) => /** @type {any} */ (fetch(local, init)) });
    assert.deepEqual(r, { situacao: "SEM_FOTO" });
    assert.equal(pedidos.every((p) => p === "/foto.jpg"), true, "o redirecionamento nunca foi seguido");
  } finally {
    await new Promise((resolve) => servidor.close(() => resolve(undefined)));
  }
});

test("foiRedirecionamento: erros sem causa ou de outro tipo não contam", () => {
  assert.equal(foiRedirecionamento(null), false);
  assert.equal(foiRedirecionamento(new Error("x")), false);
  assert.equal(foiRedirecionamento(Object.assign(new TypeError("fetch failed"), { cause: new Error("outro") })), false);
});
