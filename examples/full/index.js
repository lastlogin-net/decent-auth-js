import * as decentauth from '../../index.js';
import { argv } from 'node:process';
import { serve } from '@hono/node-server';


let argIdx = 2;
const port = argv[argIdx] ? argv[argIdx] : 3000;
const dbPath = argv[++argIdx];
const adminId = argv[++argIdx];

const authPrefix = '/auth';

const kvStore = new decentauth.SqliteKvStore({
  path: dbPath,
});

const authServer = new decentauth.Server({
  kvStore,
  config: {
    runtime: "JavaScript",
    admin_id: adminId,
    path_prefix: authPrefix,
    smtp_config: {
      server_address: argv[++argIdx],
      server_port: Number(argv[++argIdx]),
      username: argv[++argIdx],
      password: argv[++argIdx],
      sender_email: argv[++argIdx],
    },
    login_methods: [
      {
        type: decentauth.LOGIN_METHOD_OIDC,
        name: "LastLogin",
        uri: "https://lastlogin.net",
      },
      {
        type: decentauth.LOGIN_METHOD_QR_CODE,
      }, 
      {
        type: decentauth.LOGIN_METHOD_ATPROTO,
      },
      {
        type: decentauth.LOGIN_METHOD_FEDIVERSE,
      },
      {
        type: decentauth.LOGIN_METHOD_EMAIL,
      },
      {
        type: decentauth.LOGIN_METHOD_FEDCM,
      },
      {
        type: decentauth.LOGIN_METHOD_ADMIN_CODE,
      },
    ],
  },
});

serve({
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname.startsWith(authPrefix)) {
      return authServer.handle(req);
    }

    return Response.redirect(`${url.origin}${authPrefix}`, 303);
  },
  port,
});
