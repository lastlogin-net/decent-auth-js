import * as decentauth from '../../index.js';
import { argv } from 'node:process';


const adminId = argv[2];
const port = argv[3] ? argv[3] : 3000;

const authPrefix = '/auth';

const server = new decentauth.Server({
  port,
  config: {
    admin_id: adminId,
    path_prefix: authPrefix,
    login_methods: [
      {
        type: decentauth.LOGIN_METHOD_OIDC,
        name: "FedIAM",
        uri: "https://login.mythik.co.uk/",
      },
      {
        type: decentauth.LOGIN_METHOD_OIDC,
        name: "LastLogin",
        uri: "https://lastlogin.net",
      },
      {
        type: decentauth.LOGIN_METHOD_QR_CODE,
      },
      {
        type: decentauth.LOGIN_METHOD_ADMIN_CODE,
      },
      {
        type: decentauth.LOGIN_METHOD_ATPROTO,
      },
      {
        type: decentauth.LOGIN_METHOD_FEDIVERSE,
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
