import { View, Text, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuthStore } from '@/stores/auth.store';
import { crmApi } from '@/lib/api-client';
import type { Deal } from '@/lib/api-client';

const STAGE_COLOR: Record<Deal['stage'], string> = {
  new: 'bg-slate-100 text-slate-700',
  qualified: 'bg-blue-100 text-blue-700',
  proposal: 'bg-indigo-100 text-indigo-700',
  negotiation: 'bg-amber-100 text-amber-700',
  won: 'bg-green-100 text-green-700',
  lost: 'bg-red-100 text-red-700',
};

const STAGE_FILTERS: Array<{ value: Deal['stage'] | ''; label: string }> = [
  { value: '', label: 'All' },
  { value: 'new', label: 'New' },
  { value: 'proposal', label: 'Proposal' },
  { value: 'won', label: 'Won' },
  { value: 'lost', label: 'Lost' },
];

function DealCard({ deal }: { deal: Deal }) {
  const formatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: deal.currency,
    maximumFractionDigits: 0,
  }).format(deal.value);

  return (
    <TouchableOpacity
      className="mx-4 mb-2 rounded-xl border border-gray-200 bg-white p-4"
      activeOpacity={0.7}
    >
      <View className="flex-row items-start justify-between">
        <Text className="flex-1 pr-2 font-semibold text-gray-900">{deal.title}</Text>
        <Text className="text-base font-bold text-gray-900">{formatted}</Text>
      </View>
      <Text className="mt-0.5 text-xs text-gray-500">{deal.contactName}</Text>
      <View className="mt-2 flex-row items-center justify-between">
        <View className={`rounded-full px-2 py-0.5 ${STAGE_COLOR[deal.stage]}`}>
          <Text className="text-xs font-medium">{deal.stage}</Text>
        </View>
        <Text className="text-xs text-gray-400">
          Close {new Date(deal.closeDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

export default function DealsScreen() {
  const { token, tenantId } = useAuthStore();
  const [stageFilter, setStageFilter] = useState<string>('');
  const ctx = { token: token ?? '', tenantId: tenantId ?? '' };

  const { data, isLoading } = useQuery({
    queryKey: ['deals-mobile', { stage: stageFilter }],
    queryFn: () => crmApi.getDeals({ stage: stageFilter || undefined, limit: 50 }, ctx),
    enabled: Boolean(token && tenantId),
  });

  const totalValue = data?.data.reduce((s, d) => s + d.value, 0) ?? 0;

  return (
    <View className="flex-1 bg-gray-50">
      <View className="bg-white px-4 pb-3 pt-4">
        <View className="flex-row items-center justify-between">
          <Text className="text-xl font-bold text-gray-900">Deals</Text>
          <Text className="text-sm font-semibold text-indigo-600">
            {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(totalValue)}
          </Text>
        </View>

        {/* Stage filter chips */}
        <View className="mt-3 flex-row gap-2">
          {STAGE_FILTERS.map(({ value, label }) => (
            <TouchableOpacity
              key={value}
              onPress={() => setStageFilter(value)}
              className={`rounded-full px-3 py-1 ${stageFilter === value ? 'bg-indigo-600' : 'bg-gray-100'}`}
            >
              <Text className={`text-xs font-medium ${stageFilter === value ? 'text-white' : 'text-gray-600'}`}>
                {label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#4f6ef7" />
        </View>
      ) : (
        <FlatList
          data={data?.data ?? []}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <DealCard deal={item} />}
          contentContainerStyle={{ paddingTop: 12, paddingBottom: 24 }}
          ListEmptyComponent={
            <Text className="mt-12 text-center text-sm text-gray-500">No deals found.</Text>
          }
        />
      )}
    </View>
  );
}
