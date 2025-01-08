import * as decentauth from '../../index.js';
import { argv } from 'node:process';
import { serve } from '@hono/node-server';


const port = argv[2] ? argv[2] : 3000;
const adminId = argv[3];

const authPrefix = '/auth';

const authServer = new decentauth.Server({
  config: {
    admin_id: adminId,
    path_prefix: authPrefix,
    smtp_config: {
      server_address: argv[4],
      server_port: Number(argv[5]),
      username: argv[6],
      password: argv[7],
      sender_email: argv[8],
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
