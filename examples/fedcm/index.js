import * as decentauth from '../../index.js';
import { argv } from 'node:process';
import { serve } from '@hono/node-server';

const authPrefix = '/auth';

const authServer = new decentauth.Server({
  config: {
    path_prefix: authPrefix,
    login_methods: [
      {
        type: decentauth.LOGIN_METHOD_FEDCM,
      }
    ],
  },
});

serve({
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname.startsWith(authPrefix)) {
      return authServer.handle(req);
    }

    console.log("Session:", await authServer.getSession(req));

    return Response.redirect(`${url.origin}${authPrefix}`, 303);
  },
  port: 3000,
});
