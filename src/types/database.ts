export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: '14.5';
  };
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      asset_photos: {
        Row: {
          asset_id: string;
          created_at: string;
          id: string;
          storage_path: string;
        };
        Insert: {
          asset_id: string;
          created_at?: string;
          id?: string;
          storage_path: string;
        };
        Update: {
          asset_id?: string;
          created_at?: string;
          id?: string;
          storage_path?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'asset_photos_asset_id_fkey';
            columns: ['asset_id'];
            isOneToOne: false;
            referencedRelation: 'assets';
            referencedColumns: ['id'];
          },
        ];
      };
      assets: {
        Row: {
          category: string | null;
          created_at: string;
          currency: string | null;
          description: string | null;
          household_id: string;
          id: string;
          merchant: string | null;
          model_number: string | null;
          name: string;
          notes: string | null;
          property_id: string | null;
          purchase_date: string | null;
          purchase_price: number | null;
          serial_number: string | null;
          updated_at: string;
          user_category: string | null;
        };
        Insert: {
          category?: string | null;
          created_at?: string;
          currency?: string | null;
          description?: string | null;
          household_id: string;
          id?: string;
          merchant?: string | null;
          model_number?: string | null;
          name: string;
          notes?: string | null;
          property_id?: string | null;
          purchase_date?: string | null;
          purchase_price?: number | null;
          serial_number?: string | null;
          updated_at?: string;
          user_category?: string | null;
        };
        Update: {
          category?: string | null;
          created_at?: string;
          currency?: string | null;
          description?: string | null;
          household_id?: string;
          id?: string;
          merchant?: string | null;
          model_number?: string | null;
          name?: string;
          notes?: string | null;
          property_id?: string | null;
          purchase_date?: string | null;
          purchase_price?: number | null;
          serial_number?: string | null;
          updated_at?: string;
          user_category?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'assets_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'assets_property_household_fkey';
            columns: ['property_id', 'household_id'];
            isOneToOne: false;
            referencedRelation: 'properties';
            referencedColumns: ['id', 'household_id'];
          },
        ];
      };
      attention_acknowledgements: {
        Row: {
          acknowledged_at: string;
          created_at: string;
          household_id: string;
          id: string;
          source_id: string;
          source_type: string;
        };
        Insert: {
          acknowledged_at?: string;
          created_at?: string;
          household_id: string;
          id?: string;
          source_id: string;
          source_type: string;
        };
        Update: {
          acknowledged_at?: string;
          created_at?: string;
          household_id?: string;
          id?: string;
          source_id?: string;
          source_type?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'attention_acknowledgements_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
        ];
      };
      document_links: {
        Row: {
          created_at: string;
          document_id: string;
          entity_id: string;
          entity_type: string;
          id: string;
        };
        Insert: {
          created_at?: string;
          document_id: string;
          entity_id: string;
          entity_type: string;
          id?: string;
        };
        Update: {
          created_at?: string;
          document_id?: string;
          entity_id?: string;
          entity_type?: string;
          id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'document_links_document_id_fkey';
            columns: ['document_id'];
            isOneToOne: false;
            referencedRelation: 'documents';
            referencedColumns: ['id'];
          },
        ];
      };
      documents: {
        Row: {
          created_at: string;
          document_type: string | null;
          file_path: string;
          file_size: number | null;
          household_id: string;
          id: string;
          mime_type: string | null;
          name: string;
          notes: string | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          document_type?: string | null;
          file_path: string;
          file_size?: number | null;
          household_id: string;
          id?: string;
          mime_type?: string | null;
          name: string;
          notes?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          document_type?: string | null;
          file_path?: string;
          file_size?: number | null;
          household_id?: string;
          id?: string;
          mime_type?: string | null;
          name?: string;
          notes?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'documents_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
        ];
      };
      household_members: {
        Row: {
          created_at: string;
          household_id: string;
          id: string;
          role: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          household_id: string;
          id?: string;
          role?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          household_id?: string;
          id?: string;
          role?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'household_members_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'household_members_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      households: {
        Row: {
          created_at: string;
          id: string;
          name: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      maintenance_records: {
        Row: {
          asset_id: string;
          cost: number | null;
          created_at: string;
          currency: string | null;
          id: string;
          name: string;
          next_due_date: string | null;
          next_due_mileage: number | null;
          notes: string | null;
          performed_at: string | null;
          provider: string | null;
          updated_at: string;
        };
        Insert: {
          asset_id: string;
          cost?: number | null;
          created_at?: string;
          currency?: string | null;
          id?: string;
          name: string;
          next_due_date?: string | null;
          next_due_mileage?: number | null;
          notes?: string | null;
          performed_at?: string | null;
          provider?: string | null;
          updated_at?: string;
        };
        Update: {
          asset_id?: string;
          cost?: number | null;
          created_at?: string;
          currency?: string | null;
          id?: string;
          name?: string;
          next_due_date?: string | null;
          next_due_mileage?: number | null;
          notes?: string | null;
          performed_at?: string | null;
          provider?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'maintenance_records_asset_id_fkey';
            columns: ['asset_id'];
            isOneToOne: false;
            referencedRelation: 'assets';
            referencedColumns: ['id'];
          },
        ];
      };
      profiles: {
        Row: {
          avatar_url: string | null;
          created_at: string;
          display_name: string | null;
          home_section_order: string[] | null;
          id: string;
          updated_at: string;
        };
        Insert: {
          avatar_url?: string | null;
          created_at?: string;
          display_name?: string | null;
          home_section_order?: string[] | null;
          id: string;
          updated_at?: string;
        };
        Update: {
          avatar_url?: string | null;
          created_at?: string;
          display_name?: string | null;
          home_section_order?: string[] | null;
          id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      properties: {
        Row: {
          address: string | null;
          created_at: string;
          household_id: string;
          id: string;
          name: string;
          notes: string | null;
          property_type: string | null;
          updated_at: string;
        };
        Insert: {
          address?: string | null;
          created_at?: string;
          household_id: string;
          id?: string;
          name: string;
          notes?: string | null;
          property_type?: string | null;
          updated_at?: string;
        };
        Update: {
          address?: string | null;
          created_at?: string;
          household_id?: string;
          id?: string;
          name?: string;
          notes?: string | null;
          property_type?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'properties_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
        ];
      };
      recurring_expenses: {
        Row: {
          amount: number | null;
          billing_cycle: string | null;
          category: string | null;
          created_at: string;
          currency: string | null;
          household_id: string;
          id: string;
          name: string;
          next_payment_date: string | null;
          notes: string | null;
          status: string;
          updated_at: string;
        };
        Insert: {
          amount?: number | null;
          billing_cycle?: string | null;
          category?: string | null;
          created_at?: string;
          currency?: string | null;
          household_id: string;
          id?: string;
          name: string;
          next_payment_date?: string | null;
          notes?: string | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          amount?: number | null;
          billing_cycle?: string | null;
          category?: string | null;
          created_at?: string;
          currency?: string | null;
          household_id?: string;
          id?: string;
          name?: string;
          next_payment_date?: string | null;
          notes?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'recurring_expenses_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
        ];
      };
      reminders: {
        Row: {
          completed_at: string | null;
          created_at: string;
          due_at: string | null;
          household_id: string;
          id: string;
          is_completed: boolean;
          reminder_type: string | null;
          source_id: string | null;
          source_type: string | null;
          title: string;
          updated_at: string;
        };
        Insert: {
          completed_at?: string | null;
          created_at?: string;
          due_at?: string | null;
          household_id: string;
          id?: string;
          is_completed?: boolean;
          reminder_type?: string | null;
          source_id?: string | null;
          source_type?: string | null;
          title: string;
          updated_at?: string;
        };
        Update: {
          completed_at?: string | null;
          created_at?: string;
          due_at?: string | null;
          household_id?: string;
          id?: string;
          is_completed?: boolean;
          reminder_type?: string | null;
          source_id?: string | null;
          source_type?: string | null;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'reminders_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
        ];
      };
      vehicles: {
        Row: {
          asset_id: string;
          created_at: string;
          current_mileage: number | null;
          id: string;
          license_plate: string | null;
          make: string | null;
          mileage_unit: string;
          model: string | null;
          updated_at: string;
          vin: string | null;
          year: number | null;
        };
        Insert: {
          asset_id: string;
          created_at?: string;
          current_mileage?: number | null;
          id?: string;
          license_plate?: string | null;
          make?: string | null;
          mileage_unit?: string;
          model?: string | null;
          updated_at?: string;
          vin?: string | null;
          year?: number | null;
        };
        Update: {
          asset_id?: string;
          created_at?: string;
          current_mileage?: number | null;
          id?: string;
          license_plate?: string | null;
          make?: string | null;
          mileage_unit?: string;
          model?: string | null;
          updated_at?: string;
          vin?: string | null;
          year?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'vehicles_asset_id_fkey';
            columns: ['asset_id'];
            isOneToOne: true;
            referencedRelation: 'assets';
            referencedColumns: ['id'];
          },
        ];
      };
      warranties: {
        Row: {
          asset_id: string;
          created_at: string;
          expiry_date: string | null;
          id: string;
          name: string | null;
          notes: string | null;
          provider: string | null;
          start_date: string | null;
          updated_at: string;
          warranty_number: string | null;
        };
        Insert: {
          asset_id: string;
          created_at?: string;
          expiry_date?: string | null;
          id?: string;
          name?: string | null;
          notes?: string | null;
          provider?: string | null;
          start_date?: string | null;
          updated_at?: string;
          warranty_number?: string | null;
        };
        Update: {
          asset_id?: string;
          created_at?: string;
          expiry_date?: string | null;
          id?: string;
          name?: string | null;
          notes?: string | null;
          provider?: string | null;
          start_date?: string | null;
          updated_at?: string;
          warranty_number?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'warranties_asset_id_fkey';
            columns: ['asset_id'];
            isOneToOne: false;
            referencedRelation: 'assets';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      create_household: {
        Args: { household_name: string };
        Returns: {
          created_at: string;
          id: string;
          name: string;
          updated_at: string;
        };
        SetofOptions: {
          from: '*';
          to: 'households';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      is_household_member: {
        Args: { target_household_id: string };
        Returns: boolean;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema['CompositeTypes'] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const;
