import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App';
import { ApiError } from './lib/api';
// Bundled with the app, not loaded from Google: the server often runs inside a LAN.
import '@fontsource/poppins/latin-600.css';
import '@fontsource/poppins/latin-700.css';
import './index.css';

// By default a browser that believes it is offline pauses requests in silence: the button keeps
// spinning and nobody is told. This app talks to its own server, often inside a LAN, so it tries
// and says what happened; what was on screen comes back by itself when the network does.
const networkMode = 'always';

const queryClient = new QueryClient({
  defaultOptions: {
    mutations: { networkMode },
    queries: {
      networkMode,
      // This mode turns it off by default, and it is what brings a screen back after a cut.
      refetchOnReconnect: true,
      staleTime: 15_000,
      // Client errors (401/403/404/422) will not fix themselves on retry.
      retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
      refetchOnWindowFocus: false,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
