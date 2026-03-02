import { NavLink, Outlet } from 'react-router-dom';
import { LayoutDashboard, Clock, Settings, Wrench } from 'lucide-react';
import ConnectButton from './ConnectButton.tsx';
import { useDeviceStore } from '../stores/device.ts';
import { useSimulationStore } from '../stores/simulation.ts';

const navItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/history', label: 'History', icon: Clock },
  { to: '/device', label: 'Device', icon: Settings },
  { to: '/developer', label: 'Developer', icon: Wrench },
];

export default function Layout() {
  const { connectionState, error, deviceName, petName } = useDeviceStore();
  const simActive = useSimulationStore(s => s.active);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-900">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-lg font-bold">uCrit Air</span>
            {connectionState === 'connected' && petName && (
              <span className="text-lg font-semibold text-blue-400">{petName}</span>
            )}
            {deviceName && connectionState === 'connected' && (
              <span className="text-xs text-gray-400 bg-gray-800 px-2 py-0.5 rounded">
                {deviceName}
              </span>
            )}
            {simActive && (
              <span className="text-[10px] font-semibold text-purple-400 bg-purple-900/50 px-2 py-0.5 rounded">
                DEMO
              </span>
            )}
          </div>
          <ConnectButton />
        </div>
      </header>

      {/* Error banner */}
      {error && (
        <div className="bg-red-900/50 border-b border-red-800 px-4 py-2 text-sm text-red-200 text-center">
          {error}
        </div>
      )}

      {/* Reconnecting banner */}
      {connectionState === 'reconnecting' && (
        <div className="bg-yellow-900/50 border-b border-yellow-800 px-4 py-2 text-sm text-yellow-200 text-center">
          Reconnecting to device...
        </div>
      )}

      {/* Navigation — top bar on desktop, fixed bottom bar on mobile */}
      <nav className="
        fixed bottom-0 left-0 right-0 z-50 border-t border-gray-800 bg-gray-900
        sm:static sm:border-t-0 sm:border-b sm:border-gray-800 sm:bg-gray-900/50
      ">
        <div className="flex sm:max-w-6xl sm:mx-auto sm:px-4 sm:gap-1">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex flex-1 flex-col items-center gap-1 py-3 text-[11px] font-medium transition-colors
                 sm:flex-initial sm:flex-row sm:gap-2 sm:px-4 sm:text-sm sm:border-b-2
                 ${isActive
                    ? 'text-blue-400 sm:border-blue-500'
                    : 'text-gray-400 hover:text-gray-200 sm:border-transparent'
                 }`
              }
            >
              <Icon className="w-6 h-6 sm:w-4 sm:h-4" />
              <span>{label}</span>
            </NavLink>
          ))}
        </div>
      </nav>

      {/* Content — extra bottom padding on mobile for the fixed nav bar */}
      <main className="max-w-6xl mx-auto px-4 py-6 pb-24 sm:pb-6">
        <Outlet />
      </main>
    </div>
  );
}
