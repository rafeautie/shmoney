import { Link } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { SettingsGroup, SettingAction } from './settings-controls'

export function AboutSettings() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">About</CardTitle>
        <CardDescription>v{__APP_VERSION__}</CardDescription>
      </CardHeader>
      <CardContent>
        <SettingsGroup>
          <SettingAction
            label="Open source licenses"
            description="The open source software shmoney is built with."
          >
            <Button variant="outline" size="sm" asChild>
              <Link to="/licenses">View licenses</Link>
            </Button>
          </SettingAction>
        </SettingsGroup>
      </CardContent>
    </Card>
  )
}
