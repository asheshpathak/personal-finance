import { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Expenses from './pages/Expenses';
import Budgets from './pages/Budgets';
import BudgetFormPage from './pages/BudgetFormPage';
import Subscriptions from './pages/Subscriptions';
import Settings from './pages/Settings';
import Login from './pages/Login';
import { CurrencyProvider } from './context/CurrencyContext';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(!!localStorage.getItem('token'));

  return (
    <CurrencyProvider>
    <BrowserRouter>
      <Routes>
        <Route 
          path="/login" 
          element={!isAuthenticated ? <Login setAuth={setIsAuthenticated} /> : <Navigate to="/" />} 
        />
        <Route 
          path="/expenses" 
          element={isAuthenticated ? <Expenses /> : <Navigate to="/login" />} 
        />
        <Route 
          path="/budgets/new" 
          element={isAuthenticated ? <BudgetFormPage /> : <Navigate to="/login" />} 
        />
        <Route 
          path="/budgets/:id/edit" 
          element={isAuthenticated ? <BudgetFormPage /> : <Navigate to="/login" />} 
        />
        <Route 
          path="/budgets" 
          element={isAuthenticated ? <Budgets /> : <Navigate to="/login" />} 
        />
        <Route 
          path="/subscriptions" 
          element={isAuthenticated ? <Subscriptions /> : <Navigate to="/login" />} 
        />
        <Route 
          path="/settings" 
          element={isAuthenticated ? <Settings /> : <Navigate to="/login" />} 
        />
        <Route 
          path="/*" 
          element={isAuthenticated ? <Dashboard /> : <Navigate to="/login" />} 
        />
      </Routes>
    </BrowserRouter>
    </CurrencyProvider>
  );
}

export default App;
