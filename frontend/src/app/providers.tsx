import * as React from "react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { createQueryClient } from "@/lib/query-client";

export function AppProviders({ children, queryClient }: { children: React.ReactNode; queryClient?: QueryClient }) {
  const [client] = React.useState(() => queryClient ?? createQueryClient());
  return (
    <ThemeProvider>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </ThemeProvider>
  );
}
