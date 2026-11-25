import type { User } from '@seerial/domain';
import { Body, Controller, Get, Patch, Path, Route, Security, Tags } from 'tsoa';
import {
  fileSystemService,
  tmdbApiClient,
  useCases,
} from '@/api/v1/shared/infrastructure/adapters/di/container';
import { ApiResponse } from '@/api/v1/shared/infrastructure/web/http/APIResponse';
import { messages } from '@/config/messages';
import type {
  ServerConfigDTO,
  ServerConfigResponse,
  ServerPublicInfoResponse,
  ServerStatusResponse,
  ServerUserDTO,
  UpdateServerConfigDTO,
  UpdateServerDTO,
} from '../../../application/dtos/ServerDTOs';
import type { Server } from '../../../domain/Server';
import { ServerConfigService } from '../../services/ServerConfigService';
import { DEFAULT_SERVER_CONFIG, loadServerConfig } from '../../services/ServerSettings';

@Route('servers')
@Tags('Servers')
export class ServersController extends Controller {
  /**
   * Minimal public server info, used by clients before login to detect the server and show the
   * profile picker. Deliberately exposes nothing else (no API key status, no config).
   */
  @Get('public')
  @Security('public')
  public async getPublicInfo(): Promise<ApiResponse<ServerPublicInfoResponse>> {
    const allUsers: User[] = await useCases.getAllUsers().execute();

    return ApiResponse.success(
      {
        id: ServerConfigService.serverConfig.id,
        name: ServerConfigService.serverConfig.name,
        users: allUsers.map((u) => ({ id: u.id, username: u.username, avatar: u.avatar })),
      },
      messages.success.fetch,
    );
  }

  /**
   * Get server status
   */
  @Get()
  @Security('cookieAuth')
  public async getServerStatus(): Promise<ApiResponse<ServerStatusResponse>> {
    const getUsers = useCases.getAllUsers();
    const allUsers: User[] = await getUsers.execute();
    const users: ServerUserDTO[] = allUsers.map((u) => ({
      id: u.id,
      username: u.username,
      avatar: u.avatar,
    }));
    const serverId = ServerConfigService.serverConfig.id;
    const serverName = ServerConfigService.serverConfig.name;

    let apiKeyStatus: string = 'INVALID_API_KEY';
    if (tmdbApiClient.THEMOVIEDB_API_TOKEN) {
      const status = await tmdbApiClient.getAPIKeyStatus();

      if (status) {
        apiKeyStatus = 'VALID_API_KEY';
      }
    }

    return ApiResponse.success(
      {
        id: serverId,
        name: serverName,
        status: apiKeyStatus,
        users,
      },
      messages.success.fetch,
    );
  }

  /**
   * Get a specific server config setting
   */
  @Get('config/{key}')
  @Security('adminAuth')
  public async getServerConfigKey(@Path() key: string): Promise<ApiResponse<ServerConfigResponse>> {
    const { config: configData } = loadServerConfig();

    // Restrict key lookup to known settings while keeping backward-compatible null responses.
    const allowedKeys = Object.keys(DEFAULT_SERVER_CONFIG) as string[];
    const isAllowedKey = allowedKeys.includes(key);
    const value = isAllowedKey && Object.hasOwn(configData, key) ? configData[key] : null;
    return ApiResponse.success({ key, value }, messages.success.fetch);
  }

  /**
   * Get all server config settings
   */
  @Get('config')
  @Security('adminAuth')
  public async getServerConfig(): Promise<ApiResponse<ServerConfigDTO>> {
    const { config } = loadServerConfig();
    return ApiResponse.success(config as unknown as ServerConfigDTO, messages.success.fetch);
  }

  /**
   * Update server config settings
   */
  @Patch('config')
  @Security('adminAuth')
  public async updateServerConfig(
    @Body() body: UpdateServerConfigDTO,
  ): Promise<ApiResponse<ServerConfigDTO>> {
    const { file, config } = loadServerConfig();
    const configData = { ...config, ...body };

    // Synchronous on purpose: the client sends several PATCH requests back to back, and an
    // un-awaited async write let them overlap and corrupt the file.
    fileSystemService.writeFileSync(file, JSON.stringify(configData, null, 2));

    return ApiResponse.success(configData as unknown as ServerConfigDTO, messages.success.update);
  }

  /**
   * Update server configuration.
   * Declared after the static `config` routes: otherwise `PATCH /servers/config` would be
   * captured by this `{id}` route.
   */
  @Patch('{id}')
  @Security('adminAuth')
  public async update(
    @Path() id: string,
    @Body() body: UpdateServerDTO,
  ): Promise<ApiResponse<Server>> {
    const result = await useCases.updateServer().execute(id, body);
    return ApiResponse.success(result, messages.success.update);
  }
}
