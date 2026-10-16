# Bootstrap OPNsense par ISO de configuration

OPNsense n'a ni cloud-init ni API avant sa première configuration. On lui fournit donc un `config.xml`
complet au premier boot, via son **importer de configuration** (`opnsense-importer`). Ensuite, tout le
filtrage est géré par OpenTofu (stack `60-opnsense-rules`, provider `browningluke/opnsense`) avec la clé
API créée par ce `config.xml`.

## Chaîne complète (stack `10-router`, module `infra/tofu/modules/opnsense-vm`)

| Étape | Ressource tofu | Résultat |
|---|---|---|
| 1. Image système | `proxmox_virtual_environment_download_file.nano` | `OPNsense-<version>-nano-amd64.img.bz2` téléchargé par Proxmox, **sha256 vérifié** (valeur épinglée dans `stacks/10-router/variables.tf`, tirée de `OPNsense-<version>-checksums-amd64.sha256`), décompressé en `local:iso/opnsense-<version>-nano-amd64.img` |
| 2. Rendu | `templatefile(config.xml.tmpl)` → `local_sensitive_file` | `.state/opnsense/<vm>/iso/conf/config.xml` (0600, hors Git) |
| 3. ISO | `null_resource.config_iso` → `build-config-iso.sh` | `.state/opnsense/<vm>/<vm>-config-<sha12>.iso` : ISO 9660, volume `OPNCONF`, contenant **`/conf/config.xml`** |
| 4. Upload | `proxmox_virtual_environment_file.config_iso` | `local:iso/<vm>-config-<sha12>.iso` (API HTTP Proxmox) |
| 5. VM | `proxmox_virtual_environment_vm.this` | disque `scsi0` importé depuis l'image nano, ISO en `ide2` (→ `cd0` sous FreeBSD), `vtnet0` = WAN, `vtnet1` = trunk `vmbr2` |
| 6. Import | `null_resource.import_config` → `import-config.sh` → `serial-import.py` (sur l'hôte, SSH + sudo) | pilotage de la **console série** : redémarrage de la VM, réponse au prompt de l'importer, choix de `cd0` |

### Comment l'importer trouve la config
Au boot, `/usr/local/etc/rc` lance `opnsense-importer -b`. Pour chaque device proposé, l'importer
détecte le type : UFS (`s1a`/`p3`), ZFS, MSDOS (`s1`/`p1`), sinon **cd9660**. Il monte le device et
cherche **`<montage>/conf/config.xml`**, qu'il copie dans `/conf/config.xml`. L'ISO doit donc avoir
`conf/config.xml` à sa racine, ce que fait `build-config-iso.sh`.

L'importer n'est **pas automatique** : il affiche `Press any key to start the configuration importer`
pendant environ 7 s, puis demande `Select device to import from`. L'image nano démarre en
« Dual Console: Serial Primary, Video Secondary » : ce prompt n'écoute que la **console série** (des frappes
envoyées au clavier VGA par l'API `sendkey` finissent sur le `login:` sans rien importer). `import-config.sh`
lance donc `serial-import.py` sur l'hôte : il ouvre le socket série QEMU (`/var/run/qemu-server/<vmid>.serial0`),
redémarre la VM (`qm reset`), attend le texte de l'importer, appuie sur une touche, répond `cd0`, puis attend
le `login:`. Si le prompt n'apparaît pas (une config d'usine a déjà été écrite au premier boot : l'importer est alors
sauté), il se connecte en root avec le mot de passe d'usine, monte le CD, copie `/conf/config.xml` et redémarre.
En cas d'échec, il affiche la fin de la console. Symptôme d'un import raté : hostname
`OPNsense.internal` (config d'usine) et `10.20.10.1` injoignable.

Pour relancer seulement l'import sur une VM existante : `tofu apply -replace='module.opnsense.null_resource.import_config[0]'`.

### Procédure manuelle de secours (1 minute)
1. Sur l'hôte : `qm terminal 200` (console **série** ; noVNC ne montre pas le prompt), puis dans un autre shell `qm reset 200`.
2. À `Press any key to start the configuration importer`, appuyer sur une touche.
3. À `Select device to import from`, taper `cd0`, puis Entrée. Le boot continue avec la config importée.

Pour réimporter une config modifiée : `tofu apply -replace=module.opnsense.proxmox_virtual_environment_vm.this`
(recrée la VM). Un changement de `config.xml` seul produit un nouvel ISO, mais n'altère pas une VM
déjà configurée (`ignore_changes = [cdrom]`).

## Contenu de `config.xml.tmpl`
- **Interfaces** : `wan` = `vtnet0`. En mode `routed_ip`, l'IP publique routée vers la VM est en /32 (MAC
  dédiée portée par la NIC Proxmox si `wan.mac` est renseigné) et la passerelle `wan.gateway` de
  `secrets/site.sops.yaml` est déclarée `fargw` (hors sous-réseau). En mode `nat`, c'est `.2/30` du transit, avec la passerelle `.1`. Les zones sont des
  VLANs `vlan0.<tag>` sur `vtnet1` (MVC `<vlans>`, UUID déterministes) : la zone mgmt (VLAN 10) devient
  `lan`, les autres `opt1` à `opt6` par VLAN croissant. Chaque zone a l'IP `.1` de son CIDR
  (`contracts.yaml`).
- **Unbound** est actif sur toutes les interfaces internes, avec DNSSEC. Les ACL suivent
  automatiquement les réseaux des interfaces. Il n'y a pas de forwarder (résolution récursive).
- **Déchargements matériels désactivés** (`disablechecksumoffloading`, `disablesegmentationoffloading`,
  `disablelargereceiveoffloading`) : avec des NIC virtio sous Proxmox, sinon les paquets routés sortent avec une somme de
  contrôle TCP/UDP invalide et les invités les jettent (`InCsumErrors` dans `/proc/net/snmp`).
- **DHCP** est désactivé : toutes les adresses sont statiques.
- **SSH** : clé uniquement, root autorisé, à l'écoute sur `lan` (mgmt) et l'interface bastion
  seulement. Les clés viennent de `secrets/proxmox.sops.yaml` (`ssh.admin_public_keys`).
- **GUI/API** : HTTPS sur `lan` (mgmt) uniquement. La règle anti-lockout implicite de `lan` permet au
  provider tofu de joindre `https://10.20.10.1` depuis la zone mgmt (hôte `10.20.10.2`).
- **root** : hash bcrypt `root_password_bcrypt`. La clé API est `api_key`, avec un secret stocké sous
  forme de hash `crypt` SHA-512 (`api_secret_crypt`). Le provider utilise `api_key` et `api_secret` en clair.
  Tout cela vient de `secrets/opnsense.sops.yaml` (voir `secrets/opnsense.example.yaml`).
- **NAT sortant** : automatique (tous les réseaux internes derrière l'adresse WAN). Le provider ne
  gère pas l'outbound NAT.
- **NAT entrant (redirections de ports WAN)** : une règle `<nat><rule>` (format legacy) par entrée de
  `wan.public_ports` du contrat, rendue depuis la variable `port_forwards` du module (calculée par `10-router` à
  partir de `wan.public_ports` et de l'IP du service cible dans `services`) : interface `wan`, destination
  `wanip` (adresse de l'interface WAN : IP publique /32 en `routed_ip`, `.2` du transit en `nat`), cible = IP
  interne du service (`edge` pour 443/80, `netbird` pour 3478 et la plage TURN), réflexion NAT désactivée.
  Pour une plage (`49152-49252`), `local-port` vaut le premier port et pf conserve le décalage : la cible
  reçoit la même plage. **Aucune règle de filtre associée** (`associated-rule-id` vide, pas de `rdr pass`) :
  le trafic redirigé est autorisé par les règles M1 de `60-opnsense-rules` (interface `wan`, destination = IP
  interne, puisque pf filtre après la traduction) ; le filtrage reste centralisé dans la stack 60, et tout le
  reste tombe sur le blocage par défaut journalisé.
  Pourquoi ici et pas dans la stack 60 : l'API `/api/firewall/d_nat/*` utilisée par
  `opnsense_firewall_nat_port_forward` n'existe qu'à partir d'OPNsense 26.1 (404 en 25.7). Conséquence :
  **changer `wan.public_ports` (ou l'IP d'`edge`/`netbird`) impose de réimporter la configuration**,
  `tofu apply -replace=module.opnsense.proxmox_virtual_environment_vm.this` dans `10-router` (recrée la VM et
  réimporte par la console série), puis réappliquer `60-opnsense-rules` (règles M1 et reste du filtrage).
- **Filtrage** : vide au bootstrap. Le blocage par défaut est journalisé (`nologdefaultblock` absent).

## Sécurité
- Le rendu et l'ISO contiennent des hashes et la clé API. Ils vivent dans `.state/` (ignoré par Git) et
  sur `local:iso` du node. Après le bootstrap, on peut détacher le cdrom et supprimer l'ISO.
- Le secret API en clair n'est jamais écrit dans l'ISO, seulement son hash.

## Points à valider au premier déploiement
- L'import par la console série (`serial-import.py`) sur une VM fraîche ; `IMPORT_TIMEOUT` (défaut 600 s) si le boot est lent.
- Le nom des devices VLAN `vlan0.<tag>` accepté par OPNsense 25.7.
- Les redirections WAN visibles dans *Firewall > NAT > Port Forward* (4 règles « pad WAN ... »), sans règle de
  filtre liée ; `pfctl -s nat` sur OPNsense doit lister les `rdr` vers `edge` et `netbird`.
- La connexion à `https://10.20.10.1` depuis le poste opérateur : tunnel SSH par l'hôte
  (`ssh -L 8443:10.20.10.1:443 <utilisateur>@<hôte>`) ou route vers `10.20.10.0/24`. Ajuster
  `opnsense_uri` dans `60-opnsense-rules`.
