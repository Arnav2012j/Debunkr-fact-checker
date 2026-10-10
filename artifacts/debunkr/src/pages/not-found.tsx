import { Card, CardContent } from '@/components/ui/card';
import { AlertCircle } from 'lucide-react';
import { Link } from 'wouter';
import { useT } from '@/settings/SettingsContext';

export default function NotFound() {
  const t = useT();
  return (
    <div className="min-h-[100dvh] w-full flex items-center justify-center bg-background text-foreground">
      <Card className="w-full max-w-md mx-4 bg-card text-card-foreground border-border">
        <CardContent className="pt-6">
          <div className="flex mb-4 gap-2">
            <AlertCircle className="h-8 w-8 text-destructive" />
            <h1 className="text-2xl font-bold text-foreground" data-testid="text-not-found-title">{t('nf.title')}</h1>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">{t('nf.body')}</p>
          <Link href="/" className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-primary" data-testid="link-not-found-home">{t('nf.home')}</Link>
        </CardContent>
      </Card>
    </div>
  );
}
