# Frontend Directory Structure

```
frontend/
  index.html
  package.json
  tsconfig.json
  tsconfig.node.json
  vite.config.ts
  vitest.config.ts
  playwright.config.ts
  capacitor.config.ts
  .env.local
  .env.production
  .eslintrc.cjs
  .prettierrc

  public/
    favicon.ico
    logo.svg
    manifest.json

  src/
    main.tsx
    App.tsx
    index.css                        # Tailwind v4 + fire theme @theme tokens
    vite-env.d.ts

    config/
      env.ts                         # Typed env var accessor
      auth.ts                        # @aws-amplify/auth standalone config
      api.ts                         # Axios instance + interceptors
      query-client.ts                # TanStack Query client

    types/
      song.ts                        # Song, SongDetail, SearchResult, ChordEntry
      job.ts                         # Job, JobResult
      auth.ts                        # LoginResponse, RegisterResponse
      favorite.ts                    # Favorite
      api.ts                         # PaginationParams, ErrorResponse

    api/
      query-keys.ts                  # Query key factory
      auth.api.ts                    # /auth/* endpoints
      songs.api.ts                   # /api/v1/songs/* endpoints
      jobs.api.ts                    # /api/v1/jobs/* endpoints
      favorites.api.ts               # /api/v1/favorites/* endpoints

    stores/
      auth.store.ts                  # Zustand: tokens, user, isAuthenticated
      playback.store.ts              # Zustand: currentTrack, isPlaying, currentTime

    features/
      auth/
        components/
          LoginForm.tsx
          RegisterForm.tsx
          ConfirmEmailForm.tsx
          GoogleSignInButton.tsx
          AuthGuard.tsx
        hooks/
          use-login.ts
          use-register.ts
          use-confirm.ts
          use-google-auth.ts
        pages/
          LoginPage.tsx
          RegisterPage.tsx
          ConfirmEmailPage.tsx
          CallbackPage.tsx
          ProfilePage.tsx

      search/
        components/
          SearchBar.tsx
          SearchResults.tsx
          SearchResultCard.tsx
        hooks/
          use-search-songs.ts
        pages/
          SearchPage.tsx

      library/
        components/
          SongCard.tsx
          SongLibrary.tsx
          RecentSongs.tsx
          FavoritesList.tsx
        hooks/
          use-songs.ts
          use-recent-songs.ts
          use-favorites.ts
          use-toggle-favorite.ts
        pages/
          LibraryPage.tsx
          FavoritesPage.tsx

      player/
        components/
          PlayerPage.tsx
          WaveformDisplay.tsx
          TransportControls.tsx
          TrackSelector.tsx           # Radio group for stem selection
          ChordTimeline.tsx
          ChordBadge.tsx
          PlayerBar.tsx               # Persistent mini-player
          ProcessButton.tsx
          JobStatusBadge.tsx
        hooks/
          use-song-detail.ts
          use-wavesurfer.ts
          use-audio-player.ts         # Single <audio> element management
          use-chord-sync.ts
          use-create-job.ts
          use-job-polling.ts
        pages/
          SongDetailPage.tsx

    components/
      ui/                            # shadcn/ui generated (Button, Card, etc.)
      layout/
        AppShell.tsx
        Header.tsx
        BottomNav.tsx
        Sidebar.tsx
      shared/
        LoadingSpinner.tsx
        ErrorBoundary.tsx
        EmptyState.tsx
        Skeleton.tsx

    router/
      index.tsx                      # createBrowserRouter with lazy routes
      routes.ts                      # Route path constants

    lib/
      cn.ts                          # clsx + tailwind-merge
      format-duration.ts             # seconds to mm:ss
      chord-colors.ts                # chord name to color

    test/
      setup.ts                       # vitest global setup
      test-utils.tsx                 # custom render with providers
      factories/
        song.ts
        job.ts
        favorite.ts
        user.ts
      mocks/
        handlers/
          auth.ts
          songs.ts
          jobs.ts
          favorites.ts
        server.ts                    # MSW setupServer

    e2e/
      fixtures/
        auth.ts                      # Playwright auth setup
      pages/
        LoginPage.ts                 # Page Object Model
        SearchPage.ts
        SongDetailPage.ts
        FavoritesPage.ts
      specs/
        auth.spec.ts
        search.spec.ts
        player.spec.ts
        favorites.spec.ts
        mobile-nav.spec.ts
```
