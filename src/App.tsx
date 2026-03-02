import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout.tsx';
import Dashboard from './pages/Dashboard.tsx';
import History from './pages/History.tsx';
import Device from './pages/Device.tsx';
import Developer from './pages/Developer.tsx';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/history" element={<History />} />
        <Route path="/device" element={<Device />} />
        <Route path="/developer" element={<Developer />} />
      </Route>
    </Routes>
  );
}
