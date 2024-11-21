import createPlugin from "jsr:@extism/extism@2.0.0-rc10";
//import createPlugin from "https://cdn.jsdelivr.net/npm/@extism/extism@2.0.0-rc10/+esm";
//import createPlugin from '@extism/extism';

console.log("Hi there worker");

const plugin = await createPlugin(
  //"http://localhost:8000/target/wasm32-unknown-unknown/debug/decent_auth_rs.wasm",
  //"http://localhost:8000/target/wasm32-wasip1/debug/decent_auth_rs.wasm",
  //"../decent-auth-rs/target/wasm32-unknown-unknown/debug/decent_auth_rs.wasm",
  "../decent-auth-rs/target/wasm32-wasip1/debug/decent_auth_rs.wasm",
  {
    runInWorker: true,
    allowedHosts: ['*'],
    logLevel: 'debug',
    logger: console,
    useWasi: true,
  },
);

self.onmessage = async (e) => {
  const msg = e.data;

  if (msg.type === 'request') {
    const out = await plugin.call("handle", msg.req);
    postMessage({
      type: 'response',
      id: msg.id,
      res: out.json(),
    });
  }
};

//plugin.close();
