import { Flex, Text, Button, Heading, Box } from '@radix-ui/themes';
import { Home, Monitor } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { formatAppVersion } from '../utils/version';

export default function NotFound() {
  const navigate = useNavigate();

  return (
    <Flex
      direction="column"
      align="center"
      justify="center"
      // .radix-themes 是不透明底，body 的 --monitor-page-bg 被它盖住，
      // 每个页面得自己重画一遍：/ 靠 .layout，/login 与 /db-init 靠 .login-page，
      // 这里没有壳容器，所以直接画。不画的话 Aurora 这类以背景为主体的主题下是一片空白。
      style={{ minHeight: '100vh', padding: '20px', gap: '16px', background: 'var(--monitor-page-bg)' }}
    >
      <Box style={{
        width: 80, height: 80, borderRadius: '20px',
        background: 'linear-gradient(135deg, var(--accent-9), var(--accent-10))',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Monitor size={40} color="white" />
      </Box>
      <Heading size="7" style={{ letterSpacing: '-0.02em' }}>404</Heading>
      <Text size="3" color="gray">页面未找到</Text>
      <Flex gap="3" mt="2">
        <Button onClick={() => navigate('/')}>
          <Home size={16} /> 返回首页
        </Button>
        <Button variant="soft" onClick={() => navigate('/admin')}>
          管理后台
        </Button>
      </Flex>
      <Text size="1" color="gray" mt="4">
        CF VPS Monitor {formatAppVersion()}
      </Text>
    </Flex>
  );
}
