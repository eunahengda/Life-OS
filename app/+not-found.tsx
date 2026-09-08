import { Link, Stack } from 'expo-router';

import { EmptyState, Screen } from '../src/components';

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Not Found' }} />
      <Screen>
        <EmptyState
          title="This screen doesn't exist."
          description="Check the link and try again."
        />
        <Link href="/">Go to Home</Link>
      </Screen>
    </>
  );
}
