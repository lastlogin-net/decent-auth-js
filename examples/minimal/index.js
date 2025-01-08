import * as decentauth from '../../index.js';
import { argv } from 'node:process';

const authPrefix = '/auth';

const server = new decentauth.Server({
  port: 3000,
  config: {
    path_prefix: authPrefix,
    login_methods: [
      {
        type: decentauth.LOGIN_METHOD_OIDC,
        name: "LastLogin",
        uri: "https://lastlogin.net",
      }
    ],
  },
});

const handler = async (req, ctx) => {
  const url = new URL(req.url);
  return Response.redirect(`${url.origin}${authPrefix}`, 303);
};

server.serve(handler);
