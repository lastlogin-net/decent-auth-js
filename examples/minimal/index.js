import * as http from 'node:http';
import { createRequestListener } from '@mjackson/node-fetch-server';
import * as decentauth from '../../index.js';

const authPrefix = '/auth';

const authServer = new decentauth.Server({
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

async function handler(req) {
  const url = new URL(req.url);

  if (url.pathname.startsWith(authPrefix)) {
    return authServer.handle(req);
  }

  console.log("Session:", await authServer.getSession(req));

  return Response.redirect(`${url.origin}${authPrefix}`, 303);
}

// decentauth.Server.handle() expects standard `Request` objects and returns
// `Response` objects. For Node.js you'll need some way to convert to and from
// those types. We're using @mjackson/node-fetch-server here to provide an API
// similar to Deno.serve or Bun.serve. See this discussion:
// https://github.com/nodejs/node/issues/42529
http.createServer(createRequestListener(handler)).listen(3000);
