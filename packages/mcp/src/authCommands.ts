import { SecureTokenStore } from "tenantcloud-client";
import { CdpTokenProvider } from "tenantcloud-client/cdp";

export async function login(): Promise<number> {
  if (!SecureTokenStore.isSupported()) {
    console.error("Error: Secure token storage is not supported on this platform.");
    return 1;
  }

  const store = new SecureTokenStore();

  const existing = await store.load();
  if (existing) {
    console.log("Already logged in. Use 'tc-mcp logout' first to re-authenticate.");
    return 0;
  }

  console.log("Logging in to TenantCloud...");

  const provider = new CdpTokenProvider({
    tokenStore: store,
    allowInteractiveLogin: true,
  });

  try {
    const token = await provider.getToken();
    if (!token) {
      console.error("Login failed. Could not obtain a valid token.");
      return 1;
    }

    console.log("Login successful. Tokens stored in secure credential store.");
    return 0;
  } finally {
    provider.dispose();
  }
}

export async function logout(): Promise<number> {
  if (!SecureTokenStore.isSupported()) {
    console.error("Error: Secure token storage is not supported on this platform.");
    return 1;
  }

  const store = new SecureTokenStore();
  await store.delete();

  console.log("Logged out. Stored tokens have been removed.");
  return 0;
}
