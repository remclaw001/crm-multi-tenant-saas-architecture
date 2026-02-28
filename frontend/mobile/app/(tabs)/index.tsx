import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth.store';
import { crmApi } from '@/lib/api-client';

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View className="flex-1 rounded-xl border border-gray-200 bg-white p-4">
      <Text className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</Text>
      <Text className={`mt-1 text-2xl font-bold ${color}`}>{value}</Text>
    </View>
  );
}

export default function HomeScreen() {
  const { token, tenantId, user } = useAuthStore();
  const ctx = { token: token ?? '', tenantId: tenantId ?? '' };

  const contactsQuery = useQuery({
    queryKey: ['contacts-count'],
    queryFn: () => crmApi.getContacts({ limit: 1 }, ctx),
    enabled: Boolean(token && tenantId),
  });

  const dealsQuery = useQuery({
    queryKey: ['deals-count'],
    queryFn: () => crmApi.getDeals({ limit: 1 }, ctx),
    enabled: Boolean(token && tenantId),
  });

  const tasksQuery = useQuery({
    queryKey: ['tasks-count', 'todo'],
    queryFn: () => crmApi.getTasks({ status: 'todo', limit: 1 }, ctx),
    enabled: Boolean(token && tenantId),
  });

  return (
    <ScrollView className="flex-1 bg-gray-50">
      <View className="px-4 pt-6">
        <Text className="text-2xl font-bold text-gray-900">
          Hi, {user?.fullName.split(' ')[0] ?? 'there'} 👋
        </Text>
        <Text className="mt-1 text-sm text-gray-500">Here's what's happening today</Text>
      </View>

      {/* Stats row */}
      <View className="mx-4 mt-6 flex-row gap-3">
        <StatCard
          label="Contacts"
          value={contactsQuery.data ? String(contactsQuery.data.total) : '—'}
          color="text-blue-600"
        />
        <StatCard
          label="Deals"
          value={dealsQuery.data ? String(dealsQuery.data.total) : '—'}
          color="text-indigo-600"
        />
        <StatCard
          label="Tasks"
          value={tasksQuery.data ? String(tasksQuery.data.total) : '—'}
          color="text-amber-600"
        />
      </View>

      {/* Quick actions */}
      <View className="mx-4 mt-6">
        <Text className="mb-3 text-sm font-semibold text-gray-700">Quick Actions</Text>
        <View className="gap-2">
          {[
            { label: 'Add Contact', color: 'bg-blue-50 border-blue-200', textColor: 'text-blue-700' },
            { label: 'Create Deal', color: 'bg-indigo-50 border-indigo-200', textColor: 'text-indigo-700' },
            { label: 'Add Task', color: 'bg-amber-50 border-amber-200', textColor: 'text-amber-700' },
          ].map(({ label, color, textColor }) => (
            <TouchableOpacity
              key={label}
              className={`rounded-xl border p-4 ${color}`}
              activeOpacity={0.7}
            >
              <Text className={`font-medium ${textColor}`}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}
