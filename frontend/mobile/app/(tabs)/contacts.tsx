import { View, Text, FlatList, TextInput, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuthStore } from '@/stores/auth.store';
import { crmApi } from '@/lib/api-client';
import type { Contact } from '@/lib/api-client';

const STATUS_COLOR: Record<Contact['status'], string> = {
  lead: 'bg-sky-100 text-sky-700',
  prospect: 'bg-violet-100 text-violet-700',
  customer: 'bg-green-100 text-green-700',
  churned: 'bg-gray-100 text-gray-600',
};

function ContactRow({ contact }: { contact: Contact }) {
  const initials = `${contact.firstName[0]}${contact.lastName[0]}`.toUpperCase();

  return (
    <TouchableOpacity
      className="mx-4 mb-2 flex-row items-center rounded-xl border border-gray-200 bg-white p-3"
      activeOpacity={0.7}
    >
      <View className="mr-3 h-10 w-10 items-center justify-center rounded-full bg-indigo-100">
        <Text className="text-sm font-semibold text-indigo-600">{initials}</Text>
      </View>
      <View className="flex-1">
        <Text className="font-medium text-gray-900">
          {contact.firstName} {contact.lastName}
        </Text>
        <Text className="text-xs text-gray-500">{contact.email}</Text>
        {contact.company && (
          <Text className="text-xs text-gray-400">{contact.company}</Text>
        )}
      </View>
      <View className={`rounded-full px-2 py-0.5 ${STATUS_COLOR[contact.status]}`}>
        <Text className="text-xs font-medium">{contact.status}</Text>
      </View>
    </TouchableOpacity>
  );
}

export default function ContactsScreen() {
  const { token, tenantId } = useAuthStore();
  const [search, setSearch] = useState('');
  const ctx = { token: token ?? '', tenantId: tenantId ?? '' };

  const { data, isLoading } = useQuery({
    queryKey: ['contacts-mobile', { search }],
    queryFn: () => crmApi.getContacts({ search: search || undefined, limit: 50 }, ctx),
    enabled: Boolean(token && tenantId),
  });

  return (
    <View className="flex-1 bg-gray-50">
      <View className="bg-white px-4 pb-3 pt-4">
        <Text className="text-xl font-bold text-gray-900">Contacts</Text>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search..."
          className="mt-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm"
          clearButtonMode="while-editing"
        />
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#4f6ef7" />
        </View>
      ) : (
        <FlatList
          data={data?.data ?? []}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <ContactRow contact={item} />}
          contentContainerStyle={{ paddingTop: 12, paddingBottom: 24 }}
          ListEmptyComponent={
            <Text className="mt-12 text-center text-sm text-gray-500">No contacts found.</Text>
          }
        />
      )}
    </View>
  );
}
