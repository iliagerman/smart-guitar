# Google OAuth Setup for Cognito

Step-by-step instructions to create a Google OAuth 2.0 application
and connect it to the Smart Guitar Cognito user pool.

---

## Step 1: Create a Google Cloud Project

1. Go to https://console.cloud.google.com/
2. Click the project dropdown (top-left, next to "Google Cloud")
3. Click **New Project**
4. Fill in:
   - **Project name**: `smart-guitar`
   - **Organization**: (your org or "No organization")
   - **Location**: (default)
5. Click **Create**
6. Wait for the project to be created, then select it from the dropdown

---

## Step 2: Configure the OAuth Consent Screen

1. Navigate to **APIs & Services** > **OAuth consent screen**
   (or go to: https://console.cloud.google.com/apis/credentials/consent)
2. Select **External** as the user type (allows any Google account to sign in)
3. Click **Create**
4. Fill in the consent screen:

   | Field | Value |
   |-------|-------|
   | App name | `Smart Guitar` |
   | User support email | your email |
   | App logo | (optional - can add later) |
   | App home page | `https://app.smart-guitar.com` |
   | App privacy policy | `https://smart-guitar.com/privacy` (can be placeholder) |
   | App terms of service | `https://smart-guitar.com/terms` (can be placeholder) |
   | Authorized domains | `smart-guitar.com` |
   |  | `amazoncognito.com` |
   | Developer contact email | your email |

5. Click **Save and Continue**

### Scopes

6. Click **Add or Remove Scopes**
7. Add these scopes:
   - `openid` (usually pre-selected)
   - `email` — `/auth/userinfo.email`
   - `profile` — `/auth/userinfo.profile`
8. Click **Update**, then **Save and Continue**

### Test Users (Development)

9. While the app is in "Testing" status, only listed test users can sign in.
   Add your test email addresses.
10. Click **Save and Continue**

### Publishing

11. For production, click **Publish App** on the consent screen dashboard.
    Since we only request basic scopes (`openid`, `email`, `profile`), Google
    does NOT require a verification review. The app will be published immediately.

---

## Step 3: Create OAuth 2.0 Client ID

1. Navigate to **APIs & Services** > **Credentials**
   (or go to: https://console.cloud.google.com/apis/credentials)
2. Click **Create Credentials** > **OAuth client ID**
3. Fill in:

   | Field | Value |
   |-------|-------|
   | Application type | **Web application** |
   | Name | `Smart Guitar Cognito` |
   | Authorized JavaScript origins | _(leave blank)_ |
   | Authorized redirect URIs | `https://auth.smart-guitar.com/oauth2/idpresponse` |

   > **Important**: The redirect URI must be exactly
   > `https://auth.smart-guitar.com/oauth2/idpresponse`
   > — this is the fixed Cognito callback path. The domain (`auth.smart-guitar.com`)
   > must match the Cognito hosted UI domain created in Terraform.

4. Click **Create**
5. A dialog will show your credentials:

   ```
   Client ID:     123456789012-xxxxxxxxxx.apps.googleusercontent.com
   Client Secret: GOCSPX-xxxxxxxxxxxxxxxxxxxxxxxx
   ```

6. **Copy both values** — you will need them for Terraform.

---

## Step 4: Store the Credentials

Add to your project's `secrets.yml` (already gitignored):

```yaml
google_client_id: "123456789012-xxxxxxxxxx.apps.googleusercontent.com"
google_client_secret: "GOCSPX-xxxxxxxxxxxxxxxxxxxxxxxx"
```

These will be picked up by the justfile's `deploy-infra` recipe as
`TF_VAR_google_client_id` and `TF_VAR_google_client_secret`.

---

## Step 5: Apply Terraform

After saving the credentials:

```bash
just deploy-infra
```

This will:
- Create the Cognito hosted UI domain at `auth.smart-guitar.com`
- Register Google as an identity provider in the user pool
- Update the SPA client to support Google sign-in
- Create the Route53 DNS record for `auth.smart-guitar.com`

---

## Step 6: Verify

### Test via Cognito Hosted UI

Open this URL in your browser (replace values if different):

```
https://auth.smart-guitar.com/oauth2/authorize?identity_provider=Google&redirect_uri=http://localhost:5173/callback&response_type=code&client_id=6md6g1htlr1jmr62d8o47n9q6m&scope=openid+email+profile
```

This should:
1. Redirect to Google's sign-in page
2. After signing in, redirect back to `http://localhost:5173/callback?code=...`

### Check via AWS CLI

```bash
# Verify Google is listed as an identity provider
aws cognito-idp list-identity-providers \
  --user-pool-id us-east-1_HE4CcXwss

# Verify the Cognito domain is active
aws cognito-idp describe-user-pool-domain \
  --domain auth.smart-guitar.com
```

---

## Troubleshooting

### "redirect_uri_mismatch" from Google

The redirect URI in Google Console must be **exactly**:
```
https://auth.smart-guitar.com/oauth2/idpresponse
```
No trailing slash, no query parameters. Check for typos.

### "Error: invalid_client"

The Client ID or Client Secret in Terraform does not match
what's in Google Console. Re-check `secrets.yml` values.

### Cognito domain not resolving

The DNS record for `auth.smart-guitar.com` takes a few minutes to propagate.
The Cognito custom domain also provisions a CloudFront distribution,
which can take up to 15 minutes.

```bash
# Check DNS propagation
dig auth.smart-guitar.com
```

### Google consent screen shows "unverified app" warning

This is normal while the app is in "Testing" mode. Users will see a
"Google hasn't verified this app" screen. They can click "Advanced" >
"Go to Smart Guitar (unsafe)" to proceed. This goes away after
publishing the app (Step 2, section "Publishing").

---

## Reference

| Item | Value |
|------|-------|
| Google Console | https://console.cloud.google.com/apis/credentials |
| Cognito Domain | `auth.smart-guitar.com` |
| Cognito Callback (for Google) | `https://auth.smart-guitar.com/oauth2/idpresponse` |
| User Pool ID | `us-east-1_HE4CcXwss` |
| Client ID | `6md6g1htlr1jmr62d8o47n9q6m` |
| Required Scopes | `openid email profile` |
