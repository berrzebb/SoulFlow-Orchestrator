# OAuth Integration

Manage external service OAuth 2.0 integrations from **Workspace → OAuth tab** in the dashboard.

## Supported Services

| Service | service_type | Default Scopes |
|---------|-------------|---------------|
| GitHub | `github` | `repo`, `read:user` |
| Google | `google` | `openid`, `email`, `profile` |
| Custom | `custom` | User-defined |

## Prerequisites

> **Required**: Set a publicly accessible URL in **Settings → `dashboard.publicUrl`** first.
> (e.g. `https://dashboard.example.com`)
> OAuth services send callbacks to this address — localhost or internal IPs will not work.

### Creating a GitHub OAuth App

1. Go to [github.com/settings/developers](https://github.com/settings/developers)
2. **OAuth Apps** → **New OAuth App**
3. **Application name**: any name
4. **Homepage URL**: `https://your-domain.com` (your dashboard.publicUrl value)
5. **Authorization callback URL**: `https://your-domain.com/api/oauth/callback`
6. Copy the **Client ID** and **Client Secret**

### Creating a Google OAuth Client

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. **Credentials** → **Create Credentials** → **OAuth client ID**
3. Application type: **Web application**
4. **Authorized redirect URIs**: `https://your-domain.com/api/oauth/callback`
5. Copy the **Client ID** and **Client Secret**

## Adding an Integration

1. Go to **Workspace → OAuth tab**
2. Click **Add**
3. Select **Service Type** (GitHub / Google / Custom)
4. Enter **Label** (display name for the card)
5. Enter **Client ID** / **Client Secret**
   - Custom only: also enter **Auth URL** and **Token URL**
6. Select required scopes
7. Click **Add** to save

## Connecting

Click **Connect** on the integration card:

1. An OAuth popup opens
2. Authorize in the service
3. On callback success, the card status changes to **Connected** after ~3 seconds

> If the popup is blocked: click the popup-blocked icon in your browser address bar and allow.

## Card Status

| Status | Meaning |
|--------|---------|
| **Not Connected** (grey) | No token yet |
| **Connected** (green) | Valid token available |
| **Expired** (yellow) | Token expired — click Refresh |

## Token Management

| Button | Action |
|--------|--------|
| **Connect** | Start new OAuth flow via popup |
| **Refresh** | Refresh access token using refresh token |
| **Test** | Test API call with current token |
| **Edit** | Modify scopes · enabled state (service_type is immutable) |
| **Remove** | Delete integration including token |

## Using in Agents

Connected OAuth tokens can be referenced in agent tools via `oauth:{instance_id}`.

The instance ID is shown as small text at the bottom of the card.

```
User: Fetch my GitHub issues
→ Agent calls GitHub API with oauth:github token

User: List my Google Drive files
→ Agent calls Google API with oauth:google token
```

## Troubleshooting

| Symptom | Check |
|---------|-------|
| Popup doesn't open | Disable browser popup blocker |
| Connect succeeds but stays Not Connected | Check Redirect URI setting, verify Client Secret |
| Test fails | Token expired → click Refresh, or Re-Connect |
| Refresh fails | Refresh token expired in the service → Re-Connect |

## Related Docs

→ [Dashboard Guide](./dashboard.md)
→ [Security Vault](../core-concepts/security.md)
