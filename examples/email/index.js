import * as decentauth from '../../index.js';
import { argv } from 'node:process';

const authPrefix = '/auth';

const server = new decentauth.Server({
  port: 3000,
  config: {
    path_prefix: authPrefix,
    smtp_config: {
      server_address: argv[2],
      server_port: Number(argv[3]),
      username: argv[4],
      password: argv[5],
      sender_email: argv[6],
    },
    login_methods: [
      {
        type: decentauth.LOGIN_METHOD_EMAIL,
      },
    ],
  },
});

const handler = async (req, ctx) => {
  const url = new URL(req.url);

  const remoteAddr = req.headers.get('X-Forwarded-For');

  const ts = new Date().toISOString();
  console.log(`${ts}\t${req.method}\t${remoteAddr}\t${url.host}\t${url.pathname}`);

  const session = ctx.session;

  return Response.redirect(`${url.origin}${authPrefix}`, 303);
};

server.serve(handler);
