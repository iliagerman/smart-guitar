export const env = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL as string || 'http://localhost:8002',
  appEnv: (import.meta.env.VITE_APP_ENV as string) || 'local',
  cognitoUserPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID as string,
  cognitoClientId: import.meta.env.VITE_COGNITO_CLIENT_ID as string,
  cognitoDomain: import.meta.env.VITE_COGNITO_DOMAIN as string,
  runtimeObserverEndpoint: import.meta.env.VITE_RUNTIME_OBSERVER_ENDPOINT as string || 'http://127.0.0.1:4319',
  runtimeObserverApiKey: import.meta.env.VITE_RUNTIME_OBSERVER_API_KEY as string || '',
  runtimeObserverProjectName: import.meta.env.VITE_RUNTIME_OBSERVER_PROJECT_NAME as string || 'guitar-player',
  runtimeObserverEnabled: import.meta.env.VITE_RUNTIME_OBSERVER_ENABLED !== 'false',
  isLocal: (import.meta.env.VITE_APP_ENV as string) !== 'production',
} as const
