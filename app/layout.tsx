import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title:'Retention Economics Lab | Day 04', description:'Churn risk, retention economics, renewal urgency and capacity-aware intervention planning from your own customer data.' };
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
