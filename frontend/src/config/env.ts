export const env = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL as string || 'http://localhost:8002',
  appEnv: (import.meta.env.VITE_APP_ENV as string) || 'local',
  cognitoUserPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID as string,
  cognitoClientId: import.meta.env.VITE_COGNITO_CLIENT_ID as string,
  cognitoDomain: import.meta.env.VITE_COGNITO_DOMAIN as string,
  isLocal: (import.meta.env.VITE_APP_ENV as string) !== 'production',
} as const
