import { genRandomText } from './utils.js';

const FEDIVERSE_ID_TYPE_ACTIVITYPUB = 'activitypub';

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

  let app = await kvStore.get(`apps/${serverDomain}/${url.hostname}`);

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

    await kvStore.set(`apps/${serverDomain}/${url.hostname}`, app);
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


export {
  fediversePage,
  completeMastodonLogin,
};
