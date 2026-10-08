; Inno Setup script of the Windows installer; scripts/package/package.mjs stages the files and runs it.
; Vencord (with the StreamOverlay plugin), the prebuilt stream-only addon, and the Vencord patcher, with nothing to build.

#ifndef Version
  #define Version "0.0.0"
#endif
#ifndef Stage
  #error Stage is not set: run `pnpm package`
#endif
#ifndef OutputDir
  #define OutputDir "."
#endif

[Setup]
AppId={{8F2A6C1E-4B7D-4E39-9C55-3A1D7B0E6F42}
AppName=Vencord (StreamOverlay)
AppVersion={#Version}
AppPublisher=Vencord contributors
DefaultDirName={localappdata}\VencordStreamOverlay
DisableProgramGroupPage=yes
DisableDirPage=auto
PrivilegesRequired=lowest
OutputDir={#OutputDir}
OutputBaseFilename=Vencord-StreamOverlay-Setup-{#Version}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64compatible
ArchitecturesAllowed=x64compatible
UninstallFilesDir={app}\uninstall

[Tasks]
Name: "stable"; Description: "Discord (Stable)"; GroupDescription: "Patch Discord for Vencord and install the stream-only addon:"; Check: HasDiscord('Discord')
Name: "ptb"; Description: "Discord PTB"; GroupDescription: "Patch Discord for Vencord and install the stream-only addon:"; Check: HasDiscord('DiscordPTB'); Flags: unchecked
Name: "canary"; Description: "Discord Canary"; GroupDescription: "Patch Discord for Vencord and install the stream-only addon:"; Check: HasDiscord('DiscordCanary'); Flags: unchecked

[Files]
Source: "{#Stage}\dist\*"; DestDir: "{app}\dist"; Flags: ignoreversion recursesubdirs
Source: "{#Stage}\VencordInstallerCli.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#Stage}\patch.cmd"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#Stage}\LICENSE"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#Stage}\streamoverlay_nvenc.node"; DestDir: "{userappdata}\discord\StreamOverlay\nvenc"; Tasks: stable; Flags: ignoreversion
Source: "{#Stage}\streamoverlay_nvenc.node"; DestDir: "{userappdata}\discordptb\StreamOverlay\nvenc"; Tasks: ptb; Flags: ignoreversion
Source: "{#Stage}\streamoverlay_nvenc.node"; DestDir: "{userappdata}\discordcanary\StreamOverlay\nvenc"; Tasks: canary; Flags: ignoreversion

[Run]
Filename: "{cmd}"; Parameters: """/c """"{app}\patch.cmd"" -install -branch stable"""; StatusMsg: "Patching Discord (Stable)..."; Flags: runhidden waituntilterminated; Tasks: stable
Filename: "{cmd}"; Parameters: """/c """"{app}\patch.cmd"" -install -branch ptb"""; StatusMsg: "Patching Discord PTB..."; Flags: runhidden waituntilterminated; Tasks: ptb
Filename: "{cmd}"; Parameters: """/c """"{app}\patch.cmd"" -install -branch canary"""; StatusMsg: "Patching Discord Canary..."; Flags: runhidden waituntilterminated; Tasks: canary

[UninstallDelete]
Type: files; Name: "{app}\branches.txt"

[Code]
function HasDiscord(Folder: String): Boolean;
begin
  Result := DirExists(ExpandConstant('{localappdata}\') + Folder);
end;

function AddonFile(DataFolder: String): String;
begin
  Result := ExpandConstant('{userappdata}\') + DataFolder + '\StreamOverlay\nvenc\streamoverlay_nvenc.node';
end;

// A running Discord has the addon loaded: a loaded file cannot be overwritten but can be renamed, and the new one is
// used the next time Discord starts
procedure MoveAside(Task, DataFolder: String);
var
  File: String;
begin
  if not WizardIsTaskSelected(Task) then Exit;
  File := AddonFile(DataFolder);
  if FileExists(File) then
    RenameFile(File, File + '.' + GetDateTimeString('yyyymmddhhnnss', #0, #0) + '.old');
end;

procedure RemoveOld(Task, DataFolder: String);
var
  Dir: String;
  Found: TFindRec;
begin
  if not WizardIsTaskSelected(Task) then Exit;
  Dir := ExtractFilePath(AddonFile(DataFolder));
  if FindFirst(Dir + '*.old', Found) then
  try
    repeat
      DeleteFile(Dir + Found.Name);
    until not FindNext(Found);
  finally
    FindClose(Found);
  end;
end;

procedure RememberBranch(Task, Branch: String; var List: String);
begin
  if WizardIsTaskSelected(Task) then List := List + Branch + #13#10;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Branches: String;
begin
  if CurStep = ssInstall then
  begin
    MoveAside('stable', 'discord');
    MoveAside('ptb', 'discordptb');
    MoveAside('canary', 'discordcanary');
  end;

  if CurStep = ssPostInstall then
  begin
    RemoveOld('stable', 'discord');
    RemoveOld('ptb', 'discordptb');
    RemoveOld('canary', 'discordcanary');

    // what the uninstaller has to unpatch
    Branches := '';
    RememberBranch('stable', 'stable', Branches);
    RememberBranch('ptb', 'ptb', Branches);
    RememberBranch('canary', 'canary', Branches);
    SaveStringToFile(ExpandConstant('{app}\branches.txt'), Branches, False);
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  Lines: TArrayOfString;
  I, Code: Integer;
begin
  if CurUninstallStep <> usUninstall then Exit;
  if not LoadStringsFromFile(ExpandConstant('{app}\branches.txt'), Lines) then Exit;

  for I := 0 to GetArrayLength(Lines) - 1 do
    if Trim(Lines[I]) <> '' then
      Exec(ExpandConstant('{cmd}'), '/c ""' + ExpandConstant('{app}\patch.cmd') + '" -uninstall -branch ' + Trim(Lines[I]) + '"', '', SW_HIDE, ewWaitUntilTerminated, Code);
end;
