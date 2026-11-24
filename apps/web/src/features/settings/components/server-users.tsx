import {
  API,
  apiClient,
  getApiErrorMessage,
  useGet,
} from '@seerial/api';
import type { Library, PlayList, UserDTO } from '@seerial/domain';
import { useServerStore } from '@seerial/stores';
import { KeyRound, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { showToast } from '@/shared/lib/react-utils';
import AlertWrapper from '@/shared/ui/alert-wrapper';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Checkbox } from '@/shared/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';
import FlexBox from '@/shared/ui/flex-box';
import { Input } from '@/shared/ui/input';
import Loading from '@/shared/ui/loading';
import ContentWrapper from './utils/content-wrapper';

interface UserForm {
  id: string | null;
  username: string;
  password: string;
  type: 'normal' | 'admin';
  allowRemote: boolean;
  allowVideoTranscoding: boolean;
  allowDownloads: boolean;
  hideInLogin: boolean;
  maxSessions: string;
  internetBitrateLimit: string;
  libraryIds: string[];
  playlistIds: string[];
}

const EMPTY_FORM: UserForm = {
  id: null,
  username: '',
  password: '',
  type: 'normal',
  allowRemote: true,
  allowVideoTranscoding: true,
  allowDownloads: true,
  hideInLogin: false,
  maxSessions: '0',
  internetBitrateLimit: '',
  libraryIds: [],
  playlistIds: [],
};

const toForm = (user: UserDTO): UserForm => ({
  id: user.id,
  username: user.username,
  password: '',
  type: user.type === 'admin' ? 'admin' : 'normal',
  allowRemote: user.allowRemote,
  allowVideoTranscoding: user.allowVideoTranscoding,
  allowDownloads: user.allowDownloads,
  hideInLogin: user.hideInLogin,
  maxSessions: String(user.maxSessions ?? 0),
  internetBitrateLimit:
    user.internetBitrateLimit === null || user.internetBitrateLimit === undefined
      ? ''
      : String(user.internetBitrateLimit),
  libraryIds: user.libraryIds ?? [],
  playlistIds: user.playlistIds ?? [],
});

function toggleId(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
}

function ServerUsers() {
  const { t } = useTranslation();
  const currentUser = useServerStore((state) => state.currentUser);

  const { data: users, isLoading, mutate } = useGet<UserDTO[]>(API.users.findAll);
  const { data: libraries } = useGet<Library[]>(API.libraries.getAll);
  const { data: playlists } = useGet<PlayList[]>(API.playlists.getAll);

  const [form, setForm] = useState<UserForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [userToDelete, setUserToDelete] = useState<UserDTO | null>(null);

  // Playlists created from a library folder follow the access to their library
  const sharablePlaylists = (playlists ?? []).filter((playlist) => !playlist.libraryId);

  const openCreate = () => {
    setFormError(null);
    setForm({ ...EMPTY_FORM });
  };

  const openEdit = (user: UserDTO) => {
    setFormError(null);
    setForm(toForm(user));
  };

  const closeForm = () => {
    if (!saving) setForm(null);
  };

  const patchForm = (patch: Partial<UserForm>) =>
    setForm((current) => (current ? { ...current, ...patch } : current));

  const handleSave = async () => {
    if (!form) return;

    const username = form.username.trim();
    if (!username) {
      setFormError(t('adminUsersUsername'));
      return;
    }
    if (form.type === 'admin' && !form.password && !form.id) {
      setFormError(t('adminUsersPasswordRequiredAdmin'));
      return;
    }

    const bitrate = form.internetBitrateLimit.trim();
    const body: Record<string, unknown> = {
      username,
      type: form.type,
      allowRemote: form.allowRemote,
      allowVideoTranscoding: form.allowVideoTranscoding,
      allowDownloads: form.allowDownloads,
      hideInLogin: form.hideInLogin,
      maxSessions: Math.max(0, Number.parseInt(form.maxSessions, 10) || 0),
      libraryIds: form.type === 'admin' ? [] : form.libraryIds,
      playlistIds: form.type === 'admin' ? [] : form.playlistIds,
    };
    if (bitrate) body.internetBitrateLimit = Math.max(0, Number.parseInt(bitrate, 10) || 0);
    if (form.password) body.password = form.password;

    setSaving(true);
    setFormError(null);
    try {
      if (form.id) {
        await apiClient.patch(API.users.update(form.id), body);
      } else {
        await apiClient.post(API.users.create, body);
      }
      showToast('success', t('adminUsersSaved'));
      setForm(null);
      mutate();
    } catch (error) {
      setFormError(getApiErrorMessage(error, t('adminUsersError')));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!userToDelete) return;
    const target = userToDelete;
    setUserToDelete(null);
    try {
      await apiClient.delete(API.users.delete(target.id));
      showToast('success', t('adminUsersDeleted'));
      mutate();
    } catch (error) {
      showToast('error', getApiErrorMessage(error, t('adminUsersDeleteError')));
    }
  };

  const handleRevoke = async (user: UserDTO) => {
    try {
      await apiClient.post(API.users.revokeSessions(user.id), {});
      showToast('success', t('adminUsersRevoked'));
    } catch (error) {
      showToast('error', getApiErrorMessage(error));
    }
  };

  const isAdminForm = form?.type === 'admin';

  return (
    <ContentWrapper group={t('server')} section={t('adminUsers')}>
      <FlexBox justify="space-between" align="center" width="100%">
        <span className="text-muted-foreground text-sm">{t('adminUsersTitle')}</span>
        <Button onClick={openCreate} data-testid="user-add">
          <Plus size={16} /> {t('adminUsersAdd')}
        </Button>
      </FlexBox>

      {isLoading ? (
        <Loading />
      ) : !users || users.length === 0 ? (
        <span>{t('adminUsersEmpty')}</span>
      ) : (
        <FlexBox direction="column" gap={0.5} width="100%">
          {users.map((user) => {
            const isSelf = user.id === currentUser?.id;
            return (
              <div
                key={user.id}
                data-testid={`user-row-${user.username}`}
                className="bg-secondary/40 flex w-full flex-wrap items-center justify-between gap-3 rounded-lg p-3"
              >
                <FlexBox direction="column" gap={0.2}>
                  <span className="font-semibold">
                    {user.username}
                    {isSelf ? ` (${t('adminUsersYou')})` : ''}
                  </span>
                  <span className="text-muted-foreground text-sm">
                    {user.type === 'admin'
                      ? t('adminUsersAllLibraries')
                      : `${user.libraryIds?.length ?? 0} ${t('adminUsersLibrariesCount')}`}
                  </span>
                </FlexBox>
                <FlexBox gap={0.5} align="center" wrap="wrap">
                  <Badge variant={user.type === 'admin' ? 'default' : 'secondary'}>
                    {user.type === 'admin' ? t('adminUsersRoleAdmin') : t('adminUsersRoleNormal')}
                  </Badge>
                  {!user.allowRemote && <Badge variant="outline">LAN</Badge>}
                  {user.hideInLogin && <Badge variant="outline">{t('adminUsersHideInLogin')}</Badge>}
                  <Button
                    variant="ghost"
                    size="icon"
                    title={t('adminUsersEdit')}
                    data-testid={`user-edit-${user.username}`}
                    onClick={() => openEdit(user)}
                  >
                    <Pencil size={16} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    title={t('adminUsersRevoke')}
                    data-testid={`user-revoke-${user.username}`}
                    onClick={() => handleRevoke(user)}
                  >
                    <KeyRound size={16} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    title={t('adminUsersDelete')}
                    disabled={isSelf}
                    data-testid={`user-delete-${user.username}`}
                    onClick={() => setUserToDelete(user)}
                  >
                    <Trash2 size={16} />
                  </Button>
                </FlexBox>
              </div>
            );
          })}
        </FlexBox>
      )}

      <Dialog open={form !== null} onOpenChange={(open) => !open && closeForm()}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{form?.id ? t('adminUsersEdit') : t('adminUsersAdd')}</DialogTitle>
            <DialogDescription>{t('adminUsersTitle')}</DialogDescription>
          </DialogHeader>

          {form && (
            <FlexBox direction="column" gap={1} width="100%">
              <label className="flex w-full flex-col gap-1 text-sm">
                {t('adminUsersUsername')}
                <Input
                  data-testid="user-form-username"
                  value={form.username}
                  onChange={(event) => patchForm({ username: event.target.value })}
                />
              </label>

              <label className="flex w-full flex-col gap-1 text-sm">
                {t('adminUsersPassword')}
                <Input
                  type="password"
                  autoComplete="new-password"
                  data-testid="user-form-password"
                  placeholder={form.id ? t('adminUsersPasswordKeep') : ''}
                  value={form.password}
                  onChange={(event) => patchForm({ password: event.target.value })}
                />
              </label>

              <label className="flex w-full flex-col gap-1 text-sm">
                {t('adminUsersRole')}
                <select
                  data-testid="user-form-type"
                  className="border-input bg-secondary h-10 rounded-md border px-3 text-sm"
                  value={form.type}
                  onChange={(event) =>
                    patchForm({ type: event.target.value === 'admin' ? 'admin' : 'normal' })
                  }
                >
                  <option value="normal">{t('adminUsersRoleNormal')}</option>
                  <option value="admin">{t('adminUsersRoleAdmin')}</option>
                </select>
              </label>

              <FlexBox direction="column" gap={0.6} width="100%">
                <span className="text-sm font-semibold">{t('adminUsersPermissions')}</span>
                {(
                  [
                    ['allowRemote', t('adminUsersAllowRemote')],
                    ['allowVideoTranscoding', t('adminUsersAllowTranscoding')],
                    ['allowDownloads', t('adminUsersAllowDownloads')],
                    ['hideInLogin', t('adminUsersHideInLogin')],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      data-testid={`user-form-${key}`}
                      checked={form[key]}
                      onCheckedChange={(checked) => patchForm({ [key]: checked === true })}
                    />
                    {label}
                  </label>
                ))}
              </FlexBox>

              <FlexBox gap={1} wrap="wrap" width="100%">
                <label className="flex min-w-48 flex-1 flex-col gap-1 text-sm">
                  {t('adminUsersMaxSessions')}
                  <Input
                    type="number"
                    min={0}
                    data-testid="user-form-maxSessions"
                    value={form.maxSessions}
                    onChange={(event) => patchForm({ maxSessions: event.target.value })}
                  />
                </label>
                <label className="flex min-w-48 flex-1 flex-col gap-1 text-sm">
                  {t('adminUsersBitrateLimit')}
                  <Input
                    type="number"
                    min={0}
                    data-testid="user-form-bitrate"
                    value={form.internetBitrateLimit}
                    onChange={(event) => patchForm({ internetBitrateLimit: event.target.value })}
                  />
                </label>
              </FlexBox>

              {isAdminForm ? (
                <span className="text-muted-foreground text-sm">{t('adminUsersAdminFullAccess')}</span>
              ) : (
                <>
                  <FlexBox direction="column" gap={0.6} width="100%">
                    <span className="text-sm font-semibold">{t('adminUsersLibraries')}</span>
                    {!libraries || libraries.length === 0 ? (
                      <span className="text-muted-foreground text-sm">
                        {t('adminUsersLibrariesNone')}
                      </span>
                    ) : (
                      libraries.map((library) => (
                        <label key={library.id} className="flex items-center gap-2 text-sm">
                          <Checkbox
                            data-testid={`user-form-library-${library.name}`}
                            checked={form.libraryIds.includes(library.id)}
                            onCheckedChange={() =>
                              patchForm({ libraryIds: toggleId(form.libraryIds, library.id) })
                            }
                          />
                          {library.name}
                          <span className="text-muted-foreground">({library.type})</span>
                        </label>
                      ))
                    )}
                  </FlexBox>

                  <FlexBox direction="column" gap={0.6} width="100%">
                    <span className="text-sm font-semibold">{t('adminUsersPlaylists')}</span>
                    <span className="text-muted-foreground text-xs">
                      {t('adminUsersPlaylistsHint')}
                    </span>
                    {sharablePlaylists.length === 0 ? (
                      <span className="text-muted-foreground text-sm">
                        {t('adminUsersPlaylistsNone')}
                      </span>
                    ) : (
                      sharablePlaylists.map((playlist) => (
                        <label key={playlist.id} className="flex items-center gap-2 text-sm">
                          <Checkbox
                            data-testid={`user-form-playlist-${playlist.title}`}
                            checked={form.playlistIds.includes(playlist.id)}
                            onCheckedChange={() =>
                              patchForm({ playlistIds: toggleId(form.playlistIds, playlist.id) })
                            }
                          />
                          {playlist.title}
                        </label>
                      ))
                    )}
                  </FlexBox>
                </>
              )}

              {formError && (
                <span role="alert" data-testid="user-form-error" className="text-sm text-red-400">
                  {formError}
                </span>
              )}
            </FlexBox>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={closeForm} disabled={saving}>
              {t('adminUsersCancel')}
            </Button>
            <Button onClick={handleSave} disabled={saving} data-testid="user-form-save">
              {t('adminUsersSave')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertWrapper
        title={t('adminUsersDelete')}
        description={`${userToDelete?.username ?? ''}: ${t('adminUsersDeleteConfirm')}`}
        actionMessage={t('adminUsersDeleteAction')}
        action={handleDelete}
        openDialog={userToDelete !== null}
        isDeleteAlert
        closeDialog={() => setUserToDelete(null)}
      />
    </ContentWrapper>
  );
}

export default ServerUsers;
