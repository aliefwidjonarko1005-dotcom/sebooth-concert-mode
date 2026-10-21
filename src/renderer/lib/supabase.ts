import { createClient, SupabaseClient } from '@supabase/supabase-js'

import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@shared/supabaseConfig'

const supabaseUrl = SUPABASE_URL
const supabaseAnonKey = SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export function getSupabase(): SupabaseClient {
    return supabase
}

export function isSupabaseConfigured(): boolean {
    return !!supabaseUrl && !!supabaseAnonKey
}

export interface SessionHistoryItem {
    id: string
    session_id?: string
    email?: string
    print_count: number
    gallery_url?: string
    frame_name?: string
    created_at: string
}

export async function getSessionHistory(options: { limit?: number; offset?: number } = {}): Promise<{ data: SessionHistoryItem[]; total: number } | { error: string }> {
    try {
        const { limit = 20, offset = 0 } = options
        
        const { data, error, count } = await supabase
            .from('sessions')
            .select('*', { count: 'exact' })
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1)

        if (error) throw error

        return {
            data: data as SessionHistoryItem[],
            total: count || 0
        }
    } catch (err: any) {
        console.error('Failed to fetch session history:', err)
        return { error: err.message }
    }
}
