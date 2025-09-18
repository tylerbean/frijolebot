import useSWR from 'swr';

const fetcher = (url: string) => {
  console.log('Fetching:', url);
  const start = Date.now();
  return fetch(url).then(res => {
    const duration = Date.now() - start;
    console.log(`Fetch complete for ${url}: ${duration}ms, status: ${res.status}`);
    return res.json();
  }).catch(err => {
    const duration = Date.now() - start;
    console.error(`Fetch failed for ${url}: ${duration}ms`, err);
    throw err;
  });
};

export function useDiscordChannels() {
  const { data, error, isLoading, mutate } = useSWR('/api/discord/channels', fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: true,
    refreshInterval: 300000, // Refresh every 5 minutes
    dedupingInterval: 60000, // Dedupe requests within 1 minute
  });

  return {
    channels: data?.channels || [],
    isLoading,
    error,
    mutate
  };
}

export function useDiscordMonitoredChannels() {
  const { data, error, isLoading, mutate } = useSWR('/api/discord/monitored-channels', fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: true,
    refreshInterval: 300000,
    dedupingInterval: 60000,
  });

  return {
    channels: data?.channels || [],
    isLoading,
    error,
    mutate
  };
}

export function useWhatsAppChats() {
  const { data, error, isLoading, mutate } = useSWR('/api/whatsapp/chats', fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: true,
    refreshInterval: 300000,
    dedupingInterval: 60000,
  });

  return {
    chats: data?.chats || [],
    isLoading,
    error,
    mutate
  };
}

export function useWhatsAppAvailableChats() {
  const { data, error, isLoading, mutate } = useSWR('/api/whatsapp/available-chats', fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: true,
    refreshInterval: 60000, // Refresh more frequently for available chats
    dedupingInterval: 30000,
  });

  return {
    chats: data?.chats || [],
    isLoading,
    error,
    mutate
  };
}

export function useAdminSettings() {
  const { data, error, isLoading, mutate } = useSWR('/api/admin/settings', fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: true,
    refreshInterval: 300000,
    dedupingInterval: 60000,
  });

  return {
    settings: data || {},
    isLoading,
    error,
    mutate
  };
}