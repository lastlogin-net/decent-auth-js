class KvStore {
  constructor() {
    this._obj = {};
  }

  get(key) {
    return this._obj[key];
  }

  set(key, value) {
    this._obj[key] = value;
    this.persist();
  }

  list(keyPrefix) {
    const results = [];

    for (const key in this._obj) {
      if (key.startsWith(keyPrefix)) {
        results.push(this._obj[key]);
      }
    }

    return results;
  }

  delete(keyPrefix) {
    for (const key in this._obj) {
      if (key.startsWith(keyPrefix)) {
        delete this._obj[key];
      }
    }

    this.persist();
  }

  persist() {
    throw new Error("Not implemented");
  }
}


const FEDIVERSE_ID_TYPE_ACTIVITYPUB = 'activitypub';

const stylesTmpl = `
  body {
    font-family: Arial;
    display: flex;
    justify-content: center;
  }

  .content {
    width: 640px;
  }
`;

const headerTmpl = `
  <!doctype html>
  <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1" />

      <style>
        ${stylesTmpl}
      </style>
    </head>
    <body>
      <main class='content'>
`;

const footerTmpl = `
      </main>
    </body>
  </html>
`;

const loginPageTmpl = (pathPrefix) => {
  return `
    ${headerTmpl}

    <h1>Login Page</h1>

    <form action=${pathPrefix}/fediverse>
      <label for='fediverse-id-input'>Fediverse ID</label>
      <input type='text' id='fediverse-id-input' name='id' />
      <button>Submit</button>
    </form>

    ${footerTmpl}
  `;
};

async function getSession(req, kvStore) {
  const sessionKey = getCookie(req, 'session_key');
  return await kvStore.get(`sessions/${sessionKey}`)
}

function createHandler(pathPrefix, kvStore) {

  async function handler(req) {

    const url = new URL(req.url);

    const pathname = url.pathname.slice(pathPrefix.length);
    const path = pathname ? pathname : '/';

    switch (path) {
      case '/': {
        return loginPage(pathPrefix);
        break;
      }
      case '/logout': {

        const sessionKey = getCookie(req, 'session_key');
        await kvStore.delete(`sessions/${sessionKey}`)

        return new Response(null, {
          status: 303,
          headers: {
            'Location': '/',
            'Set-Cookie': `session_key=''; Path=/; Max-Age=0; Secure; HttpOnly`,
          },
        });

        break;
      }
      case '/fediverse': {
        const res = fediversePage(req, pathPrefix, kvStore);
        return res;
        break;
      }
      case '/callback': {
        return completeMastodonLogin(req, kvStore);
        break;
      }
      default: {
        return new Response("Not found", { status: 404 });
        break;
      }
    }
  }

  return handler;
}

function loginPage(pathPrefix) {
  return sendHtml(loginPageTmpl(pathPrefix));
}

async function fediversePage(req, pathPrefix, kvStore) {

  const url = new URL(req.url);
  const params = new URLSearchParams(url.search);

  const id = params.get('id');
  const parsedId = parseFediverseId(id);

  switch (parsedId.type) {
    case FEDIVERSE_ID_TYPE_ACTIVITYPUB: {
      const nodeInfo = await getNodeInfo(parsedId.server);

      if (nodeInfo.software.name !== 'mastodon') {
        throw new Error("Not a mastodon server");
      }

      const res = startMastodonLogin(req, parsedId.server, pathPrefix, kvStore);
      return res;

      break;
    }
  }

  return sendHtml("<h1>Hi there</h1>");
}

function sendHtml(html) {
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html',
    },
  });
}

function parseFediverseId(id) {

  const parts = id.split('@');

  let type;
  let server;

  if (id.startsWith('@')) {

    if (parts.length !== 3) {
      throw new Error("Invalid ID");
    }

    type = FEDIVERSE_ID_TYPE_ACTIVITYPUB;
    server = parts[2];
  }

  return {
    id,
    type,
    server,
  };
}

async function getNodeInfo(serverDomain) {
  const wellKnownUri = `https://${serverDomain}/.well-known/nodeinfo`;

  const res = await fetch(wellKnownUri);

  const wellKnownObj = await res.json();

  let nodeInfoUri;
  for (const link of wellKnownObj.links) {
    if (link.rel === 'http://nodeinfo.diaspora.software/ns/schema/2.0') {
      nodeInfoUri = link.href;
      break;
    }
  }

  if (!nodeInfoUri) {
    throw new Error(`Failed to get nodeinfo for ${serverDomain}`);
  }

  const nodeInfoRes = await fetch(nodeInfoUri);
  const nodeInfo = await nodeInfoRes.json();

  return nodeInfo;
}

async function startMastodonLogin(req, serverDomain, pathPrefix, kvStore) {

  const url = new URL(req.url);

  let app = await kvStore.get(`apps/${serverDomain}`);

  if (!app) {
    const redirectUri = `${url.origin}${pathPrefix}/callback`;

    const clientName = "LastLogin Client";
    const redirectUris = [ redirectUri ];

    const formData = new FormData();
    formData.append('client_name', clientName);
    formData.append('redirect_uris', redirectUri);
    formData.append('scopes', 'read:accounts');

    const res = await fetch(`https://${serverDomain}/api/v1/apps`, {
      method: 'POST',
      body: formData,
    });

    app = await res.json();

    await kvStore.set(`apps/${serverDomain}`, app);
  }

  const state = genRandomText(32);
  const authUri = `https://${serverDomain}/oauth/authorize?client_id=${app.client_id}&redirect_uri=${app.redirect_uri}&state=${state}&response_type=code&scope=read:accounts`;

  const authReq = {
    serverDomain,
    app,
  };

  await kvStore.set(`oauth_state/${state}`, authReq);

  return new Response(null, {
    status: 303,
    headers: {
      'Location': authUri,
    },
  });
}

async function completeMastodonLogin(req, kvStore) {

  const url = new URL(req.url);
  const params = new URLSearchParams(url.search);
  const code = params.get('code');
  const state = params.get('state');

  if (!code || !state) {
    return new Response("Missing code or state param", {
      status: 400,
    });
  }

  const authReq = await kvStore.get(`oauth_state/${state}`);
  await kvStore.delete(`oauth_state/${state}`);

  if (!authReq) {
    throw new Error("No such auth request");
  }

  const res = await fetch(`https://${authReq.serverDomain}/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },    
    body: new URLSearchParams({
      code,
      client_id: authReq.app.client_id,
      client_secret: authReq.app.client_secret,
      redirect_uri: authReq.app.redirect_uri,
      grant_type: 'authorization_code',
    }),
  });

  const tokenRes = await res.json();

  const credUri = `https://${authReq.serverDomain}/api/v1/accounts/verify_credentials`;

  const credRes = await fetch(credUri, {
    headers: {
      'Authorization': `Bearer ${tokenRes.access_token}`,
    },
  });

  if (credRes.status !== 200) {
    return new Response("Unauthorized", {
      status: 401,
    });
  }

  const credResData = await credRes.json();

  const session = {
    userIdType: 'mastodon',
    userId: `@${credResData.username}@${authReq.serverDomain}`,
    data: credResData,
  };

  const sessionKey = genRandomText(32);
  await kvStore.set(`sessions/${sessionKey}`, session);

  return new Response(null, {
    status: 303,
    headers: {
      'Location': '/',
      'Set-Cookie': `session_key=${sessionKey}; Path=/; Max-Age=84600; Secure; HttpOnly`,
    },
  });
}


function getCookie(req, name) {

  const cookiesText = req.headers.get('cookie');

  if (!cookiesText) {
    return null;
  }

  const allCookiesParts = cookiesText.split(';');

  for (const cookie of allCookiesParts) {
    const cookieText = cookie.trim();
    const cookieParts = cookieText.split('=');

    if (cookieParts[0] === name) {
      return cookieParts.slice(1).join('=');
    }
  }
}

function genRandomText(len) {
  const possible = "0123456789abcdefghijkmnpqrstuvwxyz";

  let text = "";
  for (let i = 0; i < len; i++) {
    const randIndex = Math.floor(Math.random() * possible.length);
    text += possible[randIndex];
  }

  return text;
}

export default {
  createHandler,
  getSession,
  KvStore,
};
