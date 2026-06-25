import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Flex, Card, Text, TextField, Button, Heading, Box, Separator } from '@radix-ui/themes';
import { Monitor, LogIn, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { toast } from 'sonner';
import Loading from '../components/Loading';
import { formatAppVersion } from '../utils/version';

export default function Login() {
  const { login, isAuthenticated, authLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  const redirectTo = from?.startsWith('/admin') ? from : '/admin';
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [version, setVersion] = useState('dev');

  React.useEffect(() => {
    if (isAuthenticated) navigate(redirectTo, { replace: true });
  }, [isAuthenticated, navigate, redirectTo]);

  React.useEffect(() => {
    fetch('/api/version')
      .then((r) => r.json())
      .then((data) => {
        if (data.version) setVersion(formatAppVersion(data.version));
      })
      .catch(() => {});
  }, []);

  if (authLoading) return <Loading />;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      toast.error('请输入用户名和密码');
      return;
    }

    setLoading(true);
    const error = await login(username, password);
    setLoading(false);

    if (error) {
      toast.error(error);
    } else {
      toast.success('登录成功');
      navigate(redirectTo, { replace: true });
    }
  };

  return (
    <div className="login-page">
      <Card className="login-card" style={{ padding: '36px 32px' }}>
        <Flex direction="column" align="center" gap="2" mb="5">
          <Box className="login-logo">
            <Monitor size={32} color="white" />
          </Box>
          <Heading size="6" style={{ fontSize: '1.5rem', letterSpacing: '-0.02em', fontWeight: 700 }}>
            CF VPS Monitor
          </Heading>
          <Text size="2" color="gray" style={{ marginTop: '-2px' }}>
            Cloudflare 服务器监控探针
          </Text>
        </Flex>

        <Separator size="4" mb="4" />

        <form onSubmit={handleSubmit}>
          <Flex direction="column" gap="4">
            <label htmlFor="login-username">
              <Text size="2" weight="bold" style={{ marginBottom: 6, display: 'inline-block' }}>
                用户名
              </Text>
              <TextField.Root
                id="login-username"
                size="3"
                placeholder="请输入用户名"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoFocus
                style={{ width: '100%' }}
              />
            </label>

            <label htmlFor="login-password">
              <Text size="2" weight="bold" style={{ marginBottom: 6, display: 'inline-block' }}>
                密码
              </Text>
              <div style={{ position: 'relative' }}>
                <TextField.Root
                  id="login-password"
                  size="3"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="请输入密码"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  style={{ width: '100%', paddingRight: 40 }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    position: 'absolute', right: 2, top: '50%', transform: 'translateY(-50%)',
                    width: 44, height: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                    color: 'var(--gray-9)',
                  }}
                  aria-label={showPassword ? '隐藏密码' : '显示密码'}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </label>

            <Button
              type="submit"
              size="3"
              disabled={loading}
              style={{
                marginTop: 8,
                fontWeight: 600,
                height: 44,
                fontSize: '15px',
              }}
            >
              <LogIn size={18} />
              {loading ? '登录中...' : '登录'}
            </Button>
          </Flex>
        </form>

      </Card>

      <Text size="1" color="gray" style={{ position: 'fixed', bottom: 16, textAlign: 'center' }}>
        CF VPS Monitor {version} &middot; Powered by Cloudflare Workers
      </Text>
    </div>
  );
}
